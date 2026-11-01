import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const currencies = [
    { code: "DZD", name: "Dinar algérien", rateToDzd: 1 },
    { code: "EUR", name: "Euro", rateToDzd: 150 },
    { code: "USD", name: "Dollar américain", rateToDzd: 135 },
    { code: "GBP", name: "Livre sterling", rateToDzd: 175 },
    { code: "TRY", name: "Livre turque", rateToDzd: 4 },
    { code: "AED", name: "Dirham émirati", rateToDzd: 37 }
  ];
  for (const currency of currencies) {
    await prisma.currency.upsert({ where: { code: currency.code }, update: {}, create: currency });
  }
  const dzd = await prisma.currency.findUniqueOrThrow({ where: { code: "DZD" } });
  const eur = await prisma.currency.findUniqueOrThrow({ where: { code: "EUR" } });
  const wallets = [
    { name: "N26", currencyId: eur.id },
    { name: "Paysera", currencyId: eur.id },
    { name: "AGB", currencyId: dzd.id },
    { name: "MyFin", currencyId: dzd.id },
    { name: "CCP", currencyId: dzd.id },
    { name: "Cash", currencyId: dzd.id }
  ];
  for (const wallet of wallets) {
    await prisma.wallet.upsert({ where: { name: wallet.name }, update: {}, create: wallet });
  }
}
main().finally(async () => prisma.$disconnect());
