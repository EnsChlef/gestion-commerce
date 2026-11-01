import "dotenv/config";
import express from "express";
import cors from "cors";
import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import {
  Prisma,
  PrismaClient,
  ProductStatus,
  DebtDirection,
} from "@prisma/client";
import { z } from "zod";

const prisma = new PrismaClient();
const app = express();
const port = Number(process.env.PORT || 4000);
const isProduction = process.env.NODE_ENV === "production";
if (isProduction) app.set("trust proxy", 1);

const allowedOrigins = (
  process.env.CLIENT_ORIGIN ||
  "http://localhost:5173,http://127.0.0.1:5173,http://192.168.1.5:5173"
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOriginSet = new Set(allowedOrigins);
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, false);
      return callback(null, allowedOriginSet.has(origin));
    },
    credentials: true,
  }),
);
app.use(express.json({ limit: "2mb" }));

// Single-administrator authentication. Secrets must be configured in the server environment,
// never in the React client or in the Git repository.
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "";
const ADMIN_PASSWORD_SALT = process.env.ADMIN_PASSWORD_SALT || "";
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const SESSION_COOKIE = "gestion_commerce_session";
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const sameSiteSetting = (
  process.env.AUTH_COOKIE_SAME_SITE || "lax"
).toLowerCase();
const cookieSameSite = (
  sameSiteSetting === "strict" || sameSiteSetting === "none"
    ? sameSiteSetting
    : "lax"
) as "lax" | "strict" | "none";
const cookieSecure = isProduction || cookieSameSite === "none";

if (
  !ADMIN_USERNAME ||
  !ADMIN_PASSWORD_SALT ||
  !/^[a-f0-9]{128}$/i.test(ADMIN_PASSWORD_HASH)
) {
  throw new Error(
    "Authentification non configurée : définissez ADMIN_USERNAME, ADMIN_PASSWORD_SALT et ADMIN_PASSWORD_HASH dans server/.env.",
  );
}
if (SESSION_SECRET.length < 32) {
  throw new Error(
    "SESSION_SECRET doit contenir au moins 32 caractères aléatoires dans server/.env.",
  );
}
if (isProduction && !process.env.CLIENT_ORIGIN) {
  throw new Error(
    "En production, CLIENT_ORIGIN doit contenir l'origine exacte du site client.",
  );
}

const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const safeEqual = (left: string, right: string): boolean => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};
const signSession = (payload: string) =>
  createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
const createSessionToken = (username: string) => {
  const payload = Buffer.from(
    JSON.stringify({
      sub: username,
      exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
      nonce: randomBytes(16).toString("hex"),
    }),
  ).toString("base64url");
  return `${payload}.${signSession(payload)}`;
};
const readCookie = (
  req: express.Request,
  cookieName: string,
): string | undefined => {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const item of header.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() === cookieName) {
      try {
        return decodeURIComponent(item.slice(separator + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
};
const isValidSession = (req: express.Request): boolean => {
  try {
    const token = readCookie(req, SESSION_COOKIE);
    if (!token) return false;
    const [payload, receivedSignature, extra] = token.split(".");
    if (!payload || !receivedSignature || extra !== undefined) return false;
    if (!safeEqual(receivedSignature, signSession(payload))) return false;
    const data = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { sub?: string; exp?: number };
    return (
      data.sub === ADMIN_USERNAME &&
      typeof data.exp === "number" &&
      data.exp > Math.floor(Date.now() / 1000)
    );
  } catch {
    return false;
  }
};
const requireAuth: express.RequestHandler = (req, res, next) => {
  if (!isValidSession(req)) {
    res.status(401).json({
      error: "Session expirée ou non authentifiée. Veuillez vous connecter.",
    });
    return;
  }
  next();
};
const sessionCookieOptions = {
  httpOnly: true,
  secure: cookieSecure,
  sameSite: cookieSameSite,
  maxAge: SESSION_TTL_SECONDS * 1000,
  path: "/",
} as const;

// Login endpoint is public; all business API routes are protected below.
app.post("/api/auth/login", (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const current = loginAttempts.get(ip);
  if (current && current.resetAt > now && current.count >= 8) {
    res
      .status(429)
      .json({ error: "Trop de tentatives. Réessayez dans 15 minutes." });
    return;
  }
  if (!current || current.resetAt <= now) {
    loginAttempts.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 });
  } else {
    current.count += 1;
  }

  const parsed = z
    .object({
      username: z.string().min(1).max(100),
      password: z.string().min(1).max(300),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Identifiant et mot de passe obligatoires." });
    return;
  }
  const candidateHash = scryptSync(
    parsed.data.password,
    ADMIN_PASSWORD_SALT,
    64,
  ).toString("hex");
  if (
    parsed.data.username !== ADMIN_USERNAME ||
    !safeEqual(candidateHash, ADMIN_PASSWORD_HASH.toLowerCase())
  ) {
    res.status(401).json({ error: "Identifiant ou mot de passe incorrect." });
    return;
  }

  loginAttempts.delete(ip);
  res.cookie(
    SESSION_COOKIE,
    createSessionToken(ADMIN_USERNAME),
    sessionCookieOptions,
  );
  res.json({ authenticated: true, username: ADMIN_USERNAME });
});

app.post("/api/auth/logout", (_req, res) => {
  res.clearCookie(SESSION_COOKIE, {
    ...sessionCookieOptions,
    maxAge: undefined,
  });
  res.status(204).send();
});

// Expose only the health check and authentication entry points without a session.
// Every other /api endpoint requires the signed, HttpOnly session cookie.
app.use("/api", (req, res, next) => {
  if (
    req.path === "/health" ||
    req.path === "/auth/login" ||
    req.path === "/auth/logout"
  ) {
    next();
    return;
  }
  const origin = req.get("origin");
  if (
    ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) &&
    origin &&
    !allowedOriginSet.has(origin)
  ) {
    res.status(403).json({ error: "Origine non autorisée." });
    return;
  }
  requireAuth(req, res, next);
});

app.get("/api/auth/me", (_req, res) => {
  res.json({ username: ADMIN_USERNAME });
});
const n = (v: unknown) => Number(v ?? 0);
const money = (v: number) => new Prisma.Decimal(v.toFixed(2));
const asyncRoute =
  (fn: (req: express.Request, res: express.Response) => Promise<unknown>) =>
  (req: express.Request, res: express.Response, next: express.NextFunction) => {
    void fn(req, res).catch(next);
  };
const fail = (res: express.Response, message: string, status = 400) =>
  res.status(status).json({ error: message });

function getLocalDayKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

app.get("/api/health", (_req, res) =>
  res.json({ ok: true, service: "gestion-commerce-api" }),
);

app.get(
  "/api/currencies",
  asyncRoute(async (_req, res) => {
    const rows = await prisma.currency.findMany({ orderBy: { code: "asc" } });
    res.json(rows.map((c) => ({ ...c, rateToDzd: n(c.rateToDzd) })));
  }),
);
app.patch(
  "/api/currencies/:id",
  asyncRoute(async (req, res) => {
    const body = z
      .object({ rateToDzd: z.coerce.number().positive() })
      .parse(req.body);
    const row = await prisma.currency.update({
      where: { id: req.params.id },
      data: { rateToDzd: body.rateToDzd },
    });
    res.json({ ...row, rateToDzd: n(row.rateToDzd) });
  }),
);

app.get(
  "/api/products",
  asyncRoute(async (_req, res) => {
    const rows = await prisma.product.findMany({
      include: { purchase: { include: { currency: true } }, sale: true },
      orderBy: { createdAt: "desc" },
    });
    res.json(
      rows.map((p) => ({
        ...p,
        purchase: p.purchase
          ? {
              ...p.purchase,
              purchasePrice: n(p.purchase.purchasePrice),
              shippingAmount: n(p.purchase.shippingAmount),
              extraFees: n(p.purchase.extraFees),
              exchangeRate: n(p.purchase.exchangeRate),
              totalForeign: n(p.purchase.totalForeign),
              totalCostDzd: n(p.purchase.totalCostDzd),
            }
          : null,
        sale: p.sale
          ? {
              ...p.sale,
              salePriceDzd: n(p.sale.salePriceDzd),
              costDzd: n(p.sale.costDzd),
              saleExpensesDzd: n(p.sale.saleExpensesDzd),
              profitDzd: n(p.sale.profitDzd),
            }
          : null,
      })),
    );
  }),
);

app.post(
  "/api/purchases",
  asyncRoute(async (req, res) => {
    const body = z
      .object({
        name: z.string().trim().min(1),
        category: z
          .enum([
            "PHONE",
            "LAPTOP",
            "GAME_CONSOLE",
            "ACCESSORY",
            "CLOTHING",
            "SHOES",
            "OTHER",
          ])
          .default("OTHER"),
        imageUrl: z.string().optional().or(z.literal("")),
        platform: z.string().trim().min(1),
        productUrl: z.string().optional().or(z.literal("")),
        orderNumber: z.string().optional().or(z.literal("")),
        purchaseDate: z.coerce.date(),
        currencyId: z.string(),
        purchasePrice: z.coerce.number().positive(),
        shippingAmount: z.coerce.number().nonnegative().default(0),
        extraFees: z.coerce.number().nonnegative().default(0),
        exchangeRate: z.coerce.number().positive(),
      })
      .parse(req.body);
    const currency = await prisma.currency.findUnique({
      where: { id: body.currencyId },
    });
    if (!currency) return fail(res, "Devise introuvable.");
    const totalForeign =
      body.purchasePrice + body.shippingAmount + body.extraFees;
    const totalCostDzd = totalForeign * body.exchangeRate;
    const result = await prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          name: body.name,
          category: body.category,
          imageUrl: body.imageUrl || null,
          status: ProductStatus.SENT_BY_MERCHANT,
        },
      });
      const purchase = await tx.purchase.create({
        data: {
          reference: `ACH-${Date.now()}`,
          productId: product.id,
          platform: body.platform,
          productUrl: body.productUrl || null,
          orderNumber: body.orderNumber || null,
          purchaseDate: body.purchaseDate,
          currencyId: body.currencyId,
          purchasePrice: body.purchasePrice,
          shippingAmount: body.shippingAmount,
          extraFees: body.extraFees,
          exchangeRate: body.exchangeRate,
          totalForeign,
          totalCostDzd,
        },
      });
      await tx.shippingHistory.create({
        data: { productId: product.id, status: ProductStatus.SENT_BY_MERCHANT },
      });
      return { product, purchase };
    });
    res.status(201).json(result);
  }),
);

app.patch(
  "/api/purchases/:productId",
  asyncRoute(async (req, res) => {
    const body = z
      .object({
        name: z.string().trim().min(1),
        category: z
          .enum([
            "PHONE",
            "LAPTOP",
            "GAME_CONSOLE",
            "ACCESSORY",
            "CLOTHING",
            "SHOES",
            "OTHER",
          ])
          .default("OTHER"),
        platform: z.string().trim().min(1),
        productUrl: z.string().optional().or(z.literal("")),
        orderNumber: z.string().optional().or(z.literal("")),
        purchaseDate: z.coerce.date(),
        currencyId: z.string(),
        purchasePrice: z.coerce.number().positive(),
        shippingAmount: z.coerce.number().nonnegative(),
        extraFees: z.coerce.number().nonnegative(),
        exchangeRate: z.coerce.number().positive(),
      })
      .parse(req.body);
    const existing = await prisma.product.findUnique({
      where: { id: req.params.productId },
      include: { purchase: true, sale: true },
    });
    if (!existing?.purchase)
      return fail(res, "المنتج أو عملية الشراء غير موجودة.", 404);
    const currency = await prisma.currency.findUnique({
      where: { id: body.currencyId },
    });
    if (!currency) return fail(res, "العملة غير موجودة.");
    const totalForeign =
      body.purchasePrice + body.shippingAmount + body.extraFees;
    const totalCostDzd = totalForeign * body.exchangeRate;
    const result = await prisma.$transaction(async (tx) => {
      const product = await tx.product.update({
        where: { id: existing.id },
        data: { name: body.name, category: body.category },
      });
      const purchase = await tx.purchase.update({
        where: { id: existing.purchase!.id },
        data: {
          platform: body.platform,
          productUrl: body.productUrl || null,
          orderNumber: body.orderNumber || null,
          purchaseDate: body.purchaseDate,
          currencyId: body.currencyId,
          purchasePrice: body.purchasePrice,
          shippingAmount: body.shippingAmount,
          extraFees: body.extraFees,
          exchangeRate: body.exchangeRate,
          totalForeign,
          totalCostDzd,
        },
      });
      return { product, purchase };
    });
    res.json(result);
  }),
);

app.delete(
  "/api/products/:id",
  asyncRoute(async (req, res) => {
    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
      include: { sale: true },
    });
    if (!product) return fail(res, "المنتج غير موجود.", 404);
    if (product.sale)
      return fail(
        res,
        "لا يمكن حذف منتج تم بيعه حتى لا نفقد سجل المبيعات والأرباح.",
      );

    // Purchase and shipping history are removed through the Product relations (onDelete: Cascade).
    await prisma.product.delete({ where: { id: product.id } });
    res.status(204).send();
  }),
);

app.patch(
  "/api/products/:id/status",
  asyncRoute(async (req, res) => {
    const body = z
      .object({ status: z.nativeEnum(ProductStatus) })
      .parse(req.body);
    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
      include: { sale: true },
    });
    if (!product) return fail(res, "المنتج غير موجود.", 404);
    if (product.sale) return fail(res, "المنتج مباع ولا يمكن تغيير حالته.");
    const updated = await prisma.$transaction(async (tx) => {
      const p = await tx.product.update({
        where: { id: product.id },
        data: { status: body.status },
      });
      await tx.shippingHistory.create({
        data: { productId: product.id, status: body.status },
      });
      return p;
    });
    res.json(updated);
  }),
);

app.get(
  "/api/sales",
  asyncRoute(async (req, res) => {
    const from = req.query.from ? new Date(String(req.query.from)) : undefined;
    const to = req.query.to ? new Date(String(req.query.to)) : undefined;
    if (to) to.setHours(23, 59, 59, 999);
    const where: Prisma.SaleWhereInput = {};
    if (from || to)
      where.saleDate = {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      };
    const rows = await prisma.sale.findMany({
      where,
      include: { product: true },
      orderBy: { saleDate: "desc" },
    });
    res.json(
      rows.map((s) => ({
        ...s,
        salePriceDzd: n(s.salePriceDzd),
        costDzd: n(s.costDzd),
        saleExpensesDzd: n(s.saleExpensesDzd),
        profitDzd: n(s.profitDzd),
      })),
    );
  }),
);
app.post(
  "/api/sales",
  asyncRoute(async (req, res) => {
    const body = z
      .object({
        productId: z.string(),
        saleDate: z.coerce.date(),
        salePriceDzd: z.coerce.number().positive(),
        saleExpensesDzd: z.coerce.number().nonnegative().default(0),
      })
      .parse(req.body);
    const product = await prisma.product.findUnique({
      where: { id: body.productId },
      include: { purchase: true, sale: true },
    });
    if (!product?.purchase)
      return fail(res, "المنتج أو عملية الشراء غير موجودة.", 404);
    if (product.status !== ProductStatus.AVAILABLE || product.sale)
      return fail(res, "يجب أن يكون المنتج متاحاً للبيع وغير مباع.");
    const costDzd = n(product.purchase.totalCostDzd);
    const profitDzd = body.salePriceDzd - costDzd - body.saleExpensesDzd;
    const sale = await prisma.$transaction(async (tx) => {
      const created = await tx.sale.create({
        data: {
          reference: `VTE-${Date.now()}`,
          productId: product.id,
          saleDate: body.saleDate,
          salePriceDzd: body.salePriceDzd,
          costDzd,
          saleExpensesDzd: body.saleExpensesDzd,
          profitDzd,
        },
      });
      await tx.product.update({
        where: { id: product.id },
        data: { status: ProductStatus.SOLD },
      });
      await tx.shippingHistory.create({
        data: { productId: product.id, status: ProductStatus.SOLD },
      });
      return created;
    });
    // IMPORTANT: no wallet is updated when a sale is recorded. Wallet balances are manual.
    res.status(201).json({
      ...sale,
      salePriceDzd: n(sale.salePriceDzd),
      costDzd: n(sale.costDzd),
      saleExpensesDzd: n(sale.saleExpensesDzd),
      profitDzd: n(sale.profitDzd),
    });
  }),
);

app.delete(
  "/api/sales/:id",
  asyncRoute(async (req, res) => {
    const sale = await prisma.sale.findUnique({
      where: { id: req.params.id },
    });

    if (!sale) {
      return fail(res, "عملية البيع غير موجودة.", 404);
    }

    await prisma.$transaction(async (tx) => {
      // حذف عملية البيع
      await tx.sale.delete({
        where: { id: sale.id },
      });

      // إعادة المنتج إلى المخزون المتاح
      await tx.product.update({
        where: { id: sale.productId },
        data: { status: ProductStatus.AVAILABLE },
      });

      // حذف سجل حالة SOLD المرتبط بالبيع
      await tx.shippingHistory.deleteMany({
        where: {
          productId: sale.productId,
          status: ProductStatus.SOLD,
        },
      });
    });

    res.status(204).send();
  }),
);

app.get(
  "/api/wallets",
  asyncRoute(async (_req, res) => {
    const rows = await prisma.wallet.findMany({
      include: { currency: true },
      orderBy: { name: "asc" },
    });
    res.json(
      rows.map((w) => ({
        id: w.id,
        name: w.name,
        currencyId: w.currencyId,
        currency: w.currency.code,
        rateToDzd: n(w.currency.rateToDzd),
        balance: n(w.balance),
        balanceDzd: n(w.balance) * n(w.currency.rateToDzd),
      })),
    );
  }),
);
app.patch(
  "/api/wallets/:id",
  asyncRoute(async (req, res) => {
    const body = z.object({ balance: z.coerce.number() }).parse(req.body);
    const w = await prisma.wallet.update({
      where: { id: req.params.id },
      data: { balance: body.balance },
      include: { currency: true },
    });
    res.json({
      id: w.id,
      name: w.name,
      currency: w.currency.code,
      balance: n(w.balance),
      balanceDzd: n(w.balance) * n(w.currency.rateToDzd),
    });
  }),
);

app.get(
  "/api/debts",
  asyncRoute(async (_req, res) => {
    const rows = await prisma.debt.findMany({
      include: { currency: true },
      orderBy: { createdAt: "desc" },
    });
    res.json(
      rows.map((d) => ({
        id: d.id,
        personName: d.personName,
        direction: d.direction,
        amount: n(d.amount),
        currencyId: d.currencyId,
        currency: d.currency.code,
        amountDzd: n(d.amount) * n(d.currency.rateToDzd),
      })),
    );
  }),
);
app.post(
  "/api/debts",
  asyncRoute(async (req, res) => {
    const body = z
      .object({
        personName: z.string().trim().min(1),
        direction: z.nativeEnum(DebtDirection),
        amount: z.coerce.number().positive(),
        currencyId: z.string(),
      })
      .parse(req.body);
    const row = await prisma.debt.create({
      data: body,
      include: { currency: true },
    });
    res.status(201).json({
      id: row.id,
      personName: row.personName,
      direction: row.direction,
      amount: n(row.amount),
      currencyId: row.currencyId,
      currency: row.currency.code,
      amountDzd: n(row.amount) * n(row.currency.rateToDzd),
    });
  }),
);
app.put(
  "/api/debts/:id",
  asyncRoute(async (req, res) => {
    const body = z
      .object({
        personName: z.string().trim().min(1),
        direction: z.nativeEnum(DebtDirection),
        amount: z.coerce.number().positive(),
        currencyId: z.string().min(1),
      })
      .parse(req.body);

    // Vérifier que la devise choisie existe avant la mise à jour.
    const currency = await prisma.currency.findUnique({
      where: { id: body.currencyId },
    });
    if (!currency) return fail(res, "Devise introuvable.", 404);

    const row = await prisma.debt.update({
      where: { id: req.params.id },
      data: {
        personName: body.personName,
        direction: body.direction,
        amount: body.amount,
        currencyId: body.currencyId,
      },
      include: { currency: true },
    });

    res.json({
      id: row.id,
      personName: row.personName,
      direction: row.direction,
      amount: n(row.amount),
      currencyId: row.currencyId,
      currency: row.currency.code,
      amountDzd: n(row.amount) * n(row.currency.rateToDzd),
    });
  }),
);

app.delete(
  "/api/debts/:id",
  asyncRoute(async (req, res) => {
    await prisma.debt.delete({ where: { id: req.params.id } });
    res.status(204).send();
  }),
);
app.delete(
  "/api/net-worth-history/:id",
  asyncRoute(async (req, res) => {
    const result = await prisma.netWorthHistory.deleteMany({
      where: {
        id: req.params.id,
      },
    });

    if (result.count === 0) {
      return fail(res, "Enregistrement introuvable.", 404);
    }

    res.status(204).send();
  }),
);

app.get(
  "/api/net-worth-history",
  asyncRoute(async (_req, res) => {
    const rows = await prisma.netWorthHistory.findMany({
      orderBy: { recordedAt: "desc" },
    });

    res.json(
      rows.map((row) => ({
        id: row.id,
        netWorth: n(row.netWorth),
        recordedAt: row.recordedAt,
      })),
    );
  }),
);
app.post(
  "/api/net-worth-history/save",
  asyncRoute(async (req, res) => {
    const body = z
      .object({
        netWorth: z.coerce.number().finite(),
      })
      .parse(req.body);

    const now = new Date();
    const dayKey = getLocalDayKey(now);

    // Rechercher l'enregistrement de la journée
    const existing = await prisma.netWorthHistory.findUnique({
      where: { dayKey },
    });

    let row;

    if (existing) {
      // Mettre à jour la valeur déjà enregistrée aujourd'hui
      row = await prisma.netWorthHistory.update({
        where: { id: existing.id },
        data: {
          netWorth: body.netWorth,
          recordedAt: now,
        },
      });
    } else {
      // Créer une nouvelle valeur avec son identifiant journalier
      row = await prisma.netWorthHistory.create({
        data: {
          netWorth: body.netWorth,
          dayKey: dayKey,
        },
      });
    }

    res.json({
      saved: true,
      updated: Boolean(existing),
      netWorth: n(row.netWorth),
      recordedAt: row.recordedAt,
    });
  }),
);

app.get(
  "/api/dashboard",
  asyncRoute(async (req, res) => {
    const from = req.query.from ? new Date(String(req.query.from)) : undefined;
    const to = req.query.to ? new Date(String(req.query.to)) : undefined;
    if (to) to.setHours(23, 59, 59, 999);
    const [purchases, products, sales, wallets, debts] = await Promise.all([
      prisma.purchase.findMany(),
      prisma.product.findMany({ include: { purchase: true } }),
      prisma.sale.findMany({
        where: {
          saleDate: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        },
      }),
      prisma.wallet.findMany({ include: { currency: true } }),
      prisma.debt.findMany({ include: { currency: true } }),
    ]);
    const totalPurchases = purchases.reduce((s, p) => s + n(p.totalCostDzd), 0);
    const stockValue = products
      .filter((p) => p.status !== ProductStatus.SOLD)
      .reduce((s, p) => s + n(p.purchase?.totalCostDzd), 0);
    const walletRows = wallets.map((w) => ({
      name: w.name,
      currency: w.currency.code,
      balance: n(w.balance),
      rateToDzd: n(w.currency.rateToDzd),
      balanceDzd: n(w.balance) * n(w.currency.rateToDzd),
    }));
    const liquidityDzd = walletRows
      .filter((w) => w.currency === "DZD")
      .reduce((s, w) => s + w.balanceDzd, 0);
    const foreignCurrencyDzd = walletRows
      .filter((w) => w.currency !== "DZD")
      .reduce((s, w) => s + w.balanceDzd, 0);
    const receivablesDzd = debts
      .filter((d) => d.direction === DebtDirection.OWED_TO_ME)
      .reduce((s, d) => s + n(d.amount) * n(d.currency.rateToDzd), 0);
    const payablesDzd = debts
      .filter((d) => d.direction === DebtDirection.I_OWE)
      .reduce((s, d) => s + n(d.amount) * n(d.currency.rateToDzd), 0);
    const totalProfit = sales.reduce((s, sale) => s + n(sale.profitDzd), 0);
    const soldCount = products.filter(
      (p) => p.status === ProductStatus.SOLD,
    ).length;
    const netWorth =
      liquidityDzd +
      foreignCurrencyDzd +
      stockValue +
      receivablesDzd -
      payablesDzd;
    res.json({
      totalPurchases,
      stockValue,
      liquidityDzd,
      foreignCurrencyDzd,
      receivablesDzd,
      payablesDzd,
      netWorth,
      totalProfit,
      soldCount,
      availableCount: products.filter(
        (p) => p.status === ProductStatus.AVAILABLE,
      ).length,
      // Explicitly type the list as ProductStatus[] so TypeScript accepts
      // comparison with the complete Prisma ProductStatus enum.
      inTransitCount: products.filter((p) =>
        (
          [
            ProductStatus.SENT_BY_MERCHANT,
            ProductStatus.RECEIVED_ABROAD,
            ProductStatus.SENT_TO_ALGERIA,
          ] as ProductStatus[]
        ).includes(p.status),
      ).length,
      walletRows,
    });
  }),
);

app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(err);
    if (err instanceof z.ZodError)
      return res
        .status(400)
        .json({ error: err.issues.map((i) => i.message).join("، ") });
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2025"
    )
      return res.status(404).json({ error: "العنصر غير موجود." });
    return res.status(500).json({
      error: err instanceof Error ? err.message : "خطأ داخلي في الخادم.",
    });
  },
);

app.listen(port, "0.0.0.0", () =>
  console.log(`Gestion Commerce API: http://0.0.0.0:${port}`),
);
