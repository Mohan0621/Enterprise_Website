import prisma from "../src/config/prisma.js"
import bcrypt from "bcrypt"

async function main() {
  const hashedPassword = await bcrypt.hash('12345678', 10);
  
  const admin = await prisma.user.upsert({
    where: { email: 'kishor@gmail.com' },
    update: {},
    create: {
      email: 'kishor@gmail.com',
      username: 'Kishor',
      password_hash: hashedPassword,
      phone_number: '9876543210',
      role: 'ADMIN'
    }
  });
  
  console.log('✓ Admin user created:', admin.email);

  // Add stock to all products
  const products = await prisma.product.findMany();
  
  for (const product of products) {
    await prisma.product.update({
      where: { id: product.id },
      data: { stock: Math.floor(Math.random() * 100) + 10 } // Random stock 10-110
    });
  }
  
  console.log(`✓ Added stock to ${products.length} products`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
