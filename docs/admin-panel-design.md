# Admin Panel — Technical Design (HLD + LLD)

> **Reference document for developers.** Every section is copy-paste ready or near it.
> Stack: Node.js ES Modules · Express 5 · EJS · Prisma 6 + PostgreSQL · JWT (httpOnly cookie)

---

## Table of Contents

1. [High-Level Design (HLD)](#1-high-level-design-hld)
   - 1.1 System Architecture Overview
   - 1.2 Module Breakdown
   - 1.3 Database Schema (Prisma)
   - 1.4 Folder Structure
   - 1.5 Route Map
2. [Low-Level Design (LLD)](#2-low-level-design-lld)
   - 2.1 Admin Middleware
   - 2.2 Admin Routes
   - 2.3 Product Service
   - 2.4 Order Service
   - 2.5 Dashboard Service
   - 2.6 Product Repository
   - 2.7 Product Controller
   - 2.8 Order Status Transition Rules
   - 2.9 Admin EJS Layout
   - 2.10 Key Validation Rules
   - 2.11 Error Handling Pattern
   - 2.12 Server.js Integration
3. [Implementation Order](#3-implementation-order)

---

## 1. High-Level Design (HLD)

### 1.1 System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Browser (Admin)                            │
└────────────────────────────┬────────────────────────────────────────┘
                             │  HTTP  (Cookie: authToken)
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Express Server                               │
│                         server.js                                   │
│                                                                     │
│   app.use('/admin', adminRoutes)                                    │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│               Admin Router  (adminRoutes.js)                        │
│                                                                     │
│   router.use(requireAuth)   ←── jwtmiddleware pattern              │
│   router.use(requireAdmin)  ←── role === 'ADMIN' check             │
└────────┬────────┬────────┬───────┬──────────┬────────┬─────────────┘
         │        │        │       │          │        │
         ▼        ▼        ▼       ▼          ▼        ▼
    Dashboard  Product  Category  Order  Customer  Inventory  Banner
    Controller Controller Controller Controller Controller Controller Controller
         │        │        │       │          │        │
         └────────┴────────┴───────┴──────────┴────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Services Layer                              │
│   dashboardService · productService · categoryService · ...        │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       Repositories Layer                            │
│   productRepository · categoryRepository · orderRepository · ...   │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Prisma Client (prisma.js)                       │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     PostgreSQL Database                             │
└─────────────────────────────────────────────────────────────────────┘

EJS Views:  frontend/views/admin/**  (rendered server-side, returned as HTML)
Static:     frontend/assets/css/admin.css · frontend/assets/js/admin.js
```

Key routing rule: **all `/admin/*` routes require two middleware guards in sequence** — `requireAuth` (valid JWT) then `requireAdmin` (role is `ADMIN`). Non-admin authenticated users get a `403 Forbidden` EJS page, not a JSON error.

---

### 1.2 Module Breakdown

| # | Module | Description |
|---|--------|-------------|
| 1 | **Dashboard** | High-level stats — revenue, orders, customers, low-stock alerts, recent orders |
| 2 | **Product Management** | Full CRUD for products; handles images array, specs JSON, pricing, SKU |
| 3 | **Category Management** | Hierarchical categories (parent/children); slug auto-generation; toggle active |
| 4 | **Order Management** | View and filter orders; update status with enforced state-machine transitions |
| 5 | **Customer Management** | View customer list and profiles; block / unblock accounts |
| 6 | **Inventory Management** | Stock overview; adjust quantities; full stock-change log per product |
| 7 | **Banner Management** | Create/update/delete homepage banners; control display order and active state |

---

### 1.3 Database Schema (Prisma)

Add the following to `prisma/schema.prisma`. The existing `User`, `Address`, `Gender`, and `Role` models remain unchanged except for the new `orders` relation on `User`.

```prisma
// ─── Updated User model (add orders relation) ────────────────────────────────

model User {
  id            String   @id @default(cuid())
  username      String
  email         String   @unique
  password_hash String
  gender        Gender?
  role          Role     @default(USER)
  is_blocked    Boolean  @default(false)   // ← NEW: for customer block/unblock
  created_at    DateTime @default(now())
  updated_at    DateTime @updatedAt
  phone_number  String   @unique

  addresses     Address[]
  orders        Order[]   // ← NEW relation
}

// ─── Category ────────────────────────────────────────────────────────────────

model Category {
  id         String    @id @default(cuid())
  name       String    @unique
  slug       String    @unique
  image_url  String?
  parent_id  String?
  is_active  Boolean   @default(true)
  created_at DateTime  @default(now())
  updated_at DateTime  @updatedAt

  parent     Category?  @relation("CategoryTree", fields: [parent_id], references: [id])
  children   Category[] @relation("CategoryTree")
  products   Product[]

  @@index([slug])
  @@index([parent_id])
}

// ─── Brand ───────────────────────────────────────────────────────────────────

model Brand {
  id        String    @id @default(cuid())
  name      String    @unique
  logo_url  String?
  is_active Boolean   @default(true)

  products  Product[]
}

// ─── Product ─────────────────────────────────────────────────────────────────

model Product {
  id                  String   @id @default(cuid())
  name                String
  slug                String   @unique
  description         String?
  sku                 String   @unique
  brand_id            String
  category_id         String
  price               Decimal  @db.Decimal(10, 2)
  mrp                 Decimal  @db.Decimal(10, 2)
  discount_percent    Float    @default(0)
  stock_quantity      Int      @default(0)
  low_stock_threshold Int      @default(5)
  images              String[]
  specs               Json     @default("{}")
  is_active           Boolean  @default(true)
  is_featured         Boolean  @default(false)
  created_at          DateTime @default(now())
  updated_at          DateTime @updatedAt

  brand      Brand       @relation(fields: [brand_id], references: [id])
  category   Category    @relation(fields: [category_id], references: [id])
  orderItems OrderItem[]
  stockLogs  StockLog[]

  @@index([slug])
  @@index([category_id])
  @@index([brand_id])
  @@index([is_active])
  @@index([is_featured])
}

// ─── Order Enums ─────────────────────────────────────────────────────────────

enum OrderStatus {
  PENDING
  CONFIRMED
  PROCESSING
  SHIPPED
  DELIVERED
  CANCELLED
  REFUNDED
}

enum PaymentStatus {
  PENDING
  PAID
  FAILED
  REFUNDED
}

// ─── Order ───────────────────────────────────────────────────────────────────

model Order {
  id               String        @id @default(cuid())
  user_id          String
  order_number     String        @unique
  status           OrderStatus   @default(PENDING)
  payment_status   PaymentStatus @default(PENDING)
  subtotal         Decimal       @db.Decimal(10, 2)
  discount         Decimal       @default(0) @db.Decimal(10, 2)
  tax              Decimal       @default(0) @db.Decimal(10, 2)
  shipping_charge  Decimal       @default(0) @db.Decimal(10, 2)
  total            Decimal       @db.Decimal(10, 2)
  shipping_address Json
  notes            String?
  created_at       DateTime      @default(now())
  updated_at       DateTime      @updatedAt

  user   User        @relation(fields: [user_id], references: [id])
  items  OrderItem[]

  @@index([user_id])
  @@index([status])
  @@index([order_number])
  @@index([created_at])
}

// ─── OrderItem ───────────────────────────────────────────────────────────────

model OrderItem {
  id               String  @id @default(cuid())
  order_id         String
  product_id       String
  quantity         Int
  unit_price       Decimal @db.Decimal(10, 2)
  total_price      Decimal @db.Decimal(10, 2)
  product_snapshot Json    // snapshot: { name, image_url, sku }

  order   Order   @relation(fields: [order_id], references: [id], onDelete: Cascade)
  product Product @relation(fields: [product_id], references: [id])

  @@index([order_id])
  @@index([product_id])
}

// ─── StockLog ────────────────────────────────────────────────────────────────

enum StockChangeType {
  RESTOCK
  SALE
  ADJUSTMENT
  RETURN
}

model StockLog {
  id              String          @id @default(cuid())
  product_id      String
  changed_by      String          // admin user id
  change_type     StockChangeType
  quantity_change Int             // positive = added, negative = removed
  quantity_after  Int
  note            String?
  created_at      DateTime        @default(now())

  product Product @relation(fields: [product_id], references: [id])

  @@index([product_id])
  @@index([created_at])
}

// ─── Banner ──────────────────────────────────────────────────────────────────

model Banner {
  id            String   @id @default(cuid())
  title         String
  image_url     String
  link_url      String?
  display_order Int      @default(0)
  is_active     Boolean  @default(true)
  created_at    DateTime @default(now())
  updated_at    DateTime @updatedAt

  @@index([is_active])
  @@index([display_order])
}
```

After editing the schema, run:

```bash
npx prisma migrate dev --name add-admin-models
```

---

### 1.4 Folder Structure

Create all of the following. Nothing inside existing folders needs to be moved or renamed.

```
src/
├── features/
│   └── admin/
│       ├── controllers/
│       │   ├── dashboardController.js
│       │   ├── productController.js
│       │   ├── categoryController.js
│       │   ├── orderController.js
│       │   ├── customerController.js
│       │   ├── inventoryController.js
│       │   └── bannerController.js
│       ├── services/
│       │   ├── dashboardService.js
│       │   ├── productService.js
│       │   ├── categoryService.js
│       │   ├── orderService.js
│       │   ├── customerService.js
│       │   ├── inventoryService.js
│       │   └── bannerService.js
│       ├── repositories/
│       │   ├── productRepository.js
│       │   ├── categoryRepository.js
│       │   ├── orderRepository.js
│       │   ├── customerRepository.js
│       │   └── bannerRepository.js
│       └── routes/
│           └── adminRoutes.js
│
└── middleware/
    ├── jwtmiddleware.js     (existing — do NOT modify)
    └── adminMiddleware.js   (NEW)

frontend/
├── views/
│   └── admin/
│       ├── layout.ejs
│       ├── dashboard.ejs
│       ├── error.ejs
│       ├── products/
│       │   ├── index.ejs
│       │   └── form.ejs
│       ├── categories/
│       │   ├── index.ejs
│       │   └── form.ejs
│       ├── orders/
│       │   ├── index.ejs
│       │   └── detail.ejs
│       ├── customers/
│       │   ├── index.ejs
│       │   └── detail.ejs
│       ├── inventory/
│       │   └── index.ejs
│       └── banners/
│           ├── index.ejs
│           └── form.ejs
└── assets/
    ├── css/
    │   └── admin.css   (NEW)
    └── js/
        └── admin.js    (NEW)
```

---

### 1.5 Route Map

All routes are prefixed with `/admin`. All require `ADMIN` role.

| Method | Path | Controller#Method | Description |
|--------|------|-------------------|-------------|
| `GET` | `/admin` | `dashboardController#index` | Dashboard overview |
| `GET` | `/admin/products` | `productController#index` | List products (paginated, filterable) |
| `GET` | `/admin/products/new` | `productController#newForm` | Render create-product form |
| `POST` | `/admin/products` | `productController#create` | Create a new product |
| `GET` | `/admin/products/:id/edit` | `productController#editForm` | Render edit-product form |
| `PUT` | `/admin/products/:id` | `productController#update` | Update a product |
| `DELETE` | `/admin/products/:id` | `productController#destroy` | Soft-delete a product |
| `GET` | `/admin/categories` | `categoryController#index` | List categories |
| `GET` | `/admin/categories/new` | `categoryController#newForm` | Render create-category form |
| `POST` | `/admin/categories` | `categoryController#create` | Create a category |
| `GET` | `/admin/categories/:id/edit` | `categoryController#editForm` | Render edit-category form |
| `PUT` | `/admin/categories/:id` | `categoryController#update` | Update a category |
| `DELETE` | `/admin/categories/:id` | `categoryController#destroy` | Delete a category |
| `GET` | `/admin/orders` | `orderController#index` | List orders (filterable by status/date) |
| `GET` | `/admin/orders/:id` | `orderController#detail` | Order detail + items |
| `PUT` | `/admin/orders/:id/status` | `orderController#updateStatus` | Advance order status |
| `GET` | `/admin/customers` | `customerController#index` | List customers |
| `GET` | `/admin/customers/:id` | `customerController#detail` | Customer detail + order history |
| `PUT` | `/admin/customers/:id/block` | `customerController#toggleBlock` | Block / unblock a customer |
| `GET` | `/admin/inventory` | `inventoryController#index` | Stock overview + low-stock alerts |
| `PUT` | `/admin/inventory/:productId` | `inventoryController#updateStock` | Adjust stock quantity |
| `GET` | `/admin/banners` | `bannerController#index` | List banners |
| `GET` | `/admin/banners/new` | `bannerController#newForm` | Render create-banner form |
| `POST` | `/admin/banners` | `bannerController#create` | Create a banner |
| `GET` | `/admin/banners/:id/edit` | `bannerController#editForm` | Render edit-banner form |
| `PUT` | `/admin/banners/:id` | `bannerController#update` | Update a banner |
| `DELETE` | `/admin/banners/:id` | `bannerController#destroy` | Delete a banner |

> **Note on PUT/DELETE from HTML forms**: HTML forms only support GET and POST. Use either (a) `fetch()` from `admin.js` for PUT/DELETE actions, or (b) install `method-override` and add a hidden `_method` field in forms.

---

## 2. Low-Level Design (LLD)

### 2.1 Admin Middleware (`src/middleware/adminMiddleware.js`)

Two separate, composable middleware functions. `requireAuth` mirrors the exact pattern in `jwtmiddleware.js` but redirects to `/login` instead of returning JSON. `requireAdmin` is a role gate applied after auth.

```js
// src/middleware/adminMiddleware.js
import jwt from 'jsonwebtoken';
import 'dotenv/config';

/**
 * Minimal cookie parser — identical implementation to jwtmiddleware.js.
 * Extracts a single cookie value by name without needing cookie-parser.
 * @param {import('express').Request} req
 * @param {string} name
 * @returns {string|null}
 */
function getCookie(req, name) {
  const header = req.headers.cookie || '';
  const match  = header.split(';').map(c => c.trim()).find(c => c.startsWith(name + '='));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

/**
 * Verifies the `authToken` JWT cookie and sets `req.user`.
 * On failure, redirects to /login (not a JSON 401 — admin panel is page-based).
 *
 * @type {import('express').RequestHandler}
 */
export const requireAuth = (req, res, next) => {
  try {
    const token = getCookie(req, 'authToken');

    if (!token) {
      return res.redirect('/login');
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { userId, email, role }
    next();
  } catch (error) {
    // Token expired or tampered — clear the stale cookie and send to login
    res.clearCookie('authToken', { path: '/' });
    return res.redirect('/login');
  }
};

/**
 * Must be used AFTER requireAuth.
 * Allows only users whose role === 'ADMIN'.
 * Returns a 403 EJS error page for authenticated non-admin users.
 *
 * @type {import('express').RequestHandler}
 */
export const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'ADMIN') {
    return res.status(403).render('admin/error', {
      message:     'Access denied. Admin privileges required.',
      currentPage: '',
      site: {
        name:    process.env.SITE_NAME    || 'Kishor Enterprises',
        tagline: process.env.SITE_TAGLINE || 'Official Electronics Store',
      },
    });
  }
  next();
};
```

---

### 2.2 Admin Routes (`src/features/admin/routes/adminRoutes.js`)

```js
// src/features/admin/routes/adminRoutes.js
import express from 'express';
import { requireAuth, requireAdmin } from '../../../middleware/adminMiddleware.js';

import { DashboardController } from '../controllers/dashboardController.js';
import { ProductController }   from '../controllers/productController.js';
import { CategoryController }  from '../controllers/categoryController.js';
import { OrderController }     from '../controllers/orderController.js';
import { CustomerController }  from '../controllers/customerController.js';
import { InventoryController } from '../controllers/inventoryController.js';
import { BannerController }    from '../controllers/bannerController.js';

const router = express.Router();

// ─── Instantiate controllers ─────────────────────────────────────────────────
const dashboardController = new DashboardController();
const productController   = new ProductController();
const categoryController  = new CategoryController();
const orderController     = new OrderController();
const customerController  = new CustomerController();
const inventoryController = new InventoryController();
const bannerController    = new BannerController();

// ─── Apply auth + admin guard to ALL admin routes ────────────────────────────
router.use(requireAuth, requireAdmin);

// ─── Dashboard ───────────────────────────────────────────────────────────────
router.get('/', dashboardController.index.bind(dashboardController));

// ─── Products ────────────────────────────────────────────────────────────────
router.get('/products',          productController.index.bind(productController));
router.get('/products/new',      productController.newForm.bind(productController));
router.post('/products',         productController.create.bind(productController));
router.get('/products/:id/edit', productController.editForm.bind(productController));
router.put('/products/:id',      productController.update.bind(productController));
router.delete('/products/:id',   productController.destroy.bind(productController));

// ─── Categories ──────────────────────────────────────────────────────────────
router.get('/categories',          categoryController.index.bind(categoryController));
router.get('/categories/new',      categoryController.newForm.bind(categoryController));
router.post('/categories',         categoryController.create.bind(categoryController));
router.get('/categories/:id/edit', categoryController.editForm.bind(categoryController));
router.put('/categories/:id',      categoryController.update.bind(categoryController));
router.delete('/categories/:id',   categoryController.destroy.bind(categoryController));

// ─── Orders ──────────────────────────────────────────────────────────────────
router.get('/orders',            orderController.index.bind(orderController));
router.get('/orders/:id',        orderController.detail.bind(orderController));
router.put('/orders/:id/status', orderController.updateStatus.bind(orderController));

// ─── Customers ───────────────────────────────────────────────────────────────
router.get('/customers',           customerController.index.bind(customerController));
router.get('/customers/:id',       customerController.detail.bind(customerController));
router.put('/customers/:id/block', customerController.toggleBlock.bind(customerController));

// ─── Inventory ───────────────────────────────────────────────────────────────
router.get('/inventory',            inventoryController.index.bind(inventoryController));
router.put('/inventory/:productId', inventoryController.updateStock.bind(inventoryController));

// ─── Banners ─────────────────────────────────────────────────────────────────
router.get('/banners',          bannerController.index.bind(bannerController));
router.get('/banners/new',      bannerController.newForm.bind(bannerController));
router.post('/banners',         bannerController.create.bind(bannerController));
router.get('/banners/:id/edit', bannerController.editForm.bind(bannerController));
router.put('/banners/:id',      bannerController.update.bind(bannerController));
router.delete('/banners/:id',   bannerController.destroy.bind(bannerController));

export default router;
```

---

### 2.3 Product Service — Full Implementation

```js
// src/features/admin/services/productService.js
import { ProductRepository } from '../repositories/productRepository.js';
import prisma from '../../../config/prisma.js';

export class ProductService {
  constructor() {
    this.productRepo = new ProductRepository();
  }

  /**
   * Returns a paginated, filterable list of products.
   *
   * @param {{ page?: number, limit?: number, search?: string, categoryId?: string, isActive?: boolean }} opts
   * @returns {Promise<{ products: object[], total: number, page: number, totalPages: number }>}
   */
  async getAllProducts({ page = 1, limit = 20, search, categoryId, isActive } = {}) {
    const skip  = (page - 1) * limit;
    const where = {};

    if (typeof isActive === 'boolean') where.is_active = isActive;
    if (categoryId) where.category_id = categoryId;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { sku:  { contains: search, mode: 'insensitive' } },
      ];
    }

    const [products, total] = await Promise.all([
      this.productRepo.findAll({ skip, take: limit, where, orderBy: { created_at: 'desc' } }),
      this.productRepo.count(where),
    ]);

    return {
      products,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Returns a single product with full relations.
   * Throws a 404 error if the product does not exist.
   *
   * @param {string} id
   * @returns {Promise<object>}
   */
  async getProductById(id) {
    const product = await this.productRepo.findById(id);
    if (!product) {
      const err = new Error('Product not found');
      err.statusCode = 404;
      throw err;
    }
    return product;
  }

  /**
   * Validates required fields and creates a new product.
   * Slug is auto-generated from `name`; discount_percent is calculated automatically.
   *
   * @param {object} data - Raw form/body data
   * @returns {Promise<object>}
   */
  async createProduct(data) {
    const { name, sku, price, mrp, category_id, brand_id } = data;

    if (!name || !sku || !price || !mrp || !category_id || !brand_id) {
      const err = new Error('name, sku, price, mrp, category_id, and brand_id are required');
      err.statusCode = 400;
      throw err;
    }
    if (Number(price) <= 0) {
      const err = new Error('price must be greater than 0');
      err.statusCode = 400;
      throw err;
    }
    if (Number(mrp) < Number(price)) {
      const err = new Error('mrp must be greater than or equal to price');
      err.statusCode = 400;
      throw err;
    }

    const slug             = this.#generateSlug(name);
    const discount_percent = Number(mrp) > 0
      ? parseFloat(((Number(mrp) - Number(price)) / Number(mrp) * 100).toFixed(2))
      : 0;

    return this.productRepo.create({
      name,
      slug,
      description:         data.description         || null,
      sku,
      brand_id,
      category_id,
      price:               Number(price),
      mrp:                 Number(mrp),
      discount_percent,
      stock_quantity:      Number(data.stock_quantity)      || 0,
      low_stock_threshold: Number(data.low_stock_threshold) || 5,
      images:              Array.isArray(data.images) ? data.images : [],
      specs:               data.specs                || {},
      is_featured:         Boolean(data.is_featured),
    });
  }

  /**
   * Merges updates onto an existing product.
   * Re-generates the slug if `name` changes; recalculates discount_percent if pricing changes.
   *
   * @param {string} id
   * @param {object} data
   * @returns {Promise<object>}
   */
  async updateProduct(id, data) {
    const existing   = await this.getProductById(id); // throws 404 if missing
    const updateData = { ...data };

    if (data.name && data.name !== existing.name) {
      updateData.slug = this.#generateSlug(data.name);
    }

    const newPrice = Number(data.price ?? existing.price);
    const newMrp   = Number(data.mrp   ?? existing.mrp);
    if (data.price !== undefined || data.mrp !== undefined) {
      updateData.discount_percent = newMrp > 0
        ? parseFloat(((newMrp - newPrice) / newMrp * 100).toFixed(2))
        : 0;
    }

    if (data.price         !== undefined) updateData.price         = Number(data.price);
    if (data.mrp           !== undefined) updateData.mrp           = Number(data.mrp);
    if (data.stock_quantity !== undefined) updateData.stock_quantity = Number(data.stock_quantity);

    return this.productRepo.update(id, updateData);
  }

  /**
   * Soft-deletes a product (sets is_active = false).
   * Hard deletion is intentionally avoided because OrderItem rows reference products.
   *
   * @param {string} id
   * @returns {Promise<object>}
   */
  async deleteProduct(id) {
    await this.getProductById(id); // throws 404 if missing
    return this.productRepo.softDelete(id);
  }

  /**
   * Adjusts stock_quantity and writes an audit entry to StockLog.
   * Uses a Prisma transaction so both writes succeed or both fail.
   *
   * @param {string} productId
   * @param {number} quantityChange - Positive to add, negative to remove
   * @param {string} adminUserId
   * @param {string} [note]
   * @returns {Promise<object>} Updated product
   */
  async updateStock(productId, quantityChange, adminUserId, note = '') {
    const product = await this.getProductById(productId);
    const newQty  = product.stock_quantity + Number(quantityChange);

    if (newQty < 0) {
      const err = new Error('Stock quantity cannot go below 0');
      err.statusCode = 400;
      throw err;
    }

    const changeType = Number(quantityChange) >= 0 ? 'RESTOCK' : 'ADJUSTMENT';

    const [updatedProduct] = await prisma.$transaction([
      prisma.product.update({
        where: { id: productId },
        data:  { stock_quantity: newQty },
      }),
      prisma.stockLog.create({
        data: {
          product_id:      productId,
          changed_by:      adminUserId,
          change_type:     changeType,
          quantity_change: Number(quantityChange),
          quantity_after:  newQty,
          note:            note || null,
        },
      }),
    ]);

    return updatedProduct;
  }

  /**
   * Converts a product name to a URL-safe slug.
   * Example: "Samsung Galaxy S24 Ultra" → "samsung-galaxy-s24-ultra"
   *
   * @param {string} name
   * @returns {string}
   */
  #generateSlug(name) {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '') // remove special characters
      .replace(/\s+/g, '-')          // spaces to hyphens
      .replace(/-+/g, '-');          // collapse consecutive hyphens
  }
}
```

---

### 2.4 Order Service — Full Implementation

```js
// src/features/admin/services/orderService.js
import { OrderRepository } from '../repositories/orderRepository.js';

// ─── State machine ───────────────────────────────────────────────────────────
// See section 2.8 for the full diagram and rules table.
const VALID_TRANSITIONS = {
  PENDING:    ['CONFIRMED', 'CANCELLED'],
  CONFIRMED:  ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['SHIPPED', 'CANCELLED'],
  SHIPPED:    ['DELIVERED'],
  DELIVERED:  ['REFUNDED'],
  CANCELLED:  [],
  REFUNDED:   [],
};

export class OrderService {
  constructor() {
    this.orderRepo = new OrderRepository();
  }

  /**
   * Returns a paginated, filterable list of orders.
   *
   * @param {{ page?: number, limit?: number, status?: string, search?: string, startDate?: string, endDate?: string }} opts
   * @returns {Promise<{ orders: object[], total: number, page: number, totalPages: number }>}
   */
  async getAllOrders({ page = 1, limit = 20, status, search, startDate, endDate } = {}) {
    const skip  = (page - 1) * limit;
    const where = {};

    if (status) where.status = status;
    if (search) {
      where.OR = [
        { order_number: { contains: search, mode: 'insensitive' } },
        { user: { email: { contains: search, mode: 'insensitive' } } },
      ];
    }
    if (startDate || endDate) {
      where.created_at = {};
      if (startDate) where.created_at.gte = new Date(startDate);
      if (endDate)   where.created_at.lte = new Date(endDate);
    }

    const [orders, total] = await Promise.all([
      this.orderRepo.findAll({ skip, take: limit, where }),
      this.orderRepo.count(where),
    ]);

    return { orders, total, page, totalPages: Math.ceil(total / limit) };
  }

  /**
   * Returns a single order with full items and customer info.
   * Throws 404 if not found.
   *
   * @param {string} id
   * @returns {Promise<object>}
   */
  async getOrderById(id) {
    const order = await this.orderRepo.findById(id);
    if (!order) {
      const err = new Error('Order not found');
      err.statusCode = 404;
      throw err;
    }
    return order;
  }

  /**
   * Advances (or cancels) an order to a new status.
   * Strictly enforces the state machine — throws 400 for invalid transitions.
   *
   * @param {string} id
   * @param {string} newStatus
   * @param {string} adminUserId - Reserved for future audit logging
   * @returns {Promise<object>} Updated order
   */
  async updateOrderStatus(id, newStatus, adminUserId) {
    // Validate that newStatus is a known enum value
    if (!Object.keys(VALID_TRANSITIONS).includes(newStatus)) {
      const err = new Error(`Unknown order status: ${newStatus}`);
      err.statusCode = 400;
      throw err;
    }

    const order = await this.getOrderById(id);

    if (!this.#isValidTransition(order.status, newStatus)) {
      const allowed = VALID_TRANSITIONS[order.status];
      const err = new Error(
        `Cannot transition order from ${order.status} to ${newStatus}. ` +
        `Allowed next states: ${allowed.length ? allowed.join(', ') : 'none (terminal state)'}`
      );
      err.statusCode = 400;
      throw err;
    }

    return this.orderRepo.updateStatus(id, newStatus);
  }

  /**
   * Checks whether transitioning from `current` to `next` is permitted.
   *
   * @param {string} current
   * @param {string} next
   * @returns {boolean}
   */
  #isValidTransition(current, next) {
    return (VALID_TRANSITIONS[current] ?? []).includes(next);
  }
}
```

---

### 2.5 Dashboard Service

```js
// src/features/admin/services/dashboardService.js
import prisma from '../../../config/prisma.js';

export class DashboardService {
  /**
   * Returns the four KPI cards shown at the top of the dashboard.
   *
   * @returns {Promise<{ todayRevenue: number, totalOrders: number, totalCustomers: number, lowStockCount: number }>}
   */
  async getSummary() {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [todayPaidOrders, totalOrders, totalCustomers, lowStockCount] = await Promise.all([
      prisma.order.findMany({
        where:  { created_at: { gte: startOfDay }, payment_status: 'PAID' },
        select: { total: true },
      }),
      prisma.order.count(),
      prisma.user.count({ where: { role: 'USER' } }),
      this.#countLowStockProducts(),
    ]);

    const todayRevenue = todayPaidOrders.reduce((sum, o) => sum + Number(o.total), 0);

    return { todayRevenue, totalOrders, totalCustomers, lowStockCount };
  }

  /**
   * Returns the most recent N orders for the dashboard activity feed.
   *
   * @param {number} [limit=10]
   * @returns {Promise<object[]>}
   */
  async getRecentOrders(limit = 10) {
    return prisma.order.findMany({
      take:    limit,
      orderBy: { created_at: 'desc' },
      include: {
        user:  { select: { username: true, email: true } },
        items: { select: { quantity: true } },
      },
    });
  }

  /**
   * Returns the top N products by total units sold across all orders.
   *
   * @param {number} [limit=5]
   * @returns {Promise<Array<{ product: object, totalSold: number }>>}
   */
  async getTopProducts(limit = 5) {
    const grouped = await prisma.orderItem.groupBy({
      by:      ['product_id'],
      _sum:    { quantity: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take:    limit,
    });

    const productIds = grouped.map(g => g.product_id);
    const products   = await prisma.product.findMany({
      where:   { id: { in: productIds } },
      include: { brand: { select: { name: true } }, category: { select: { name: true } } },
    });

    // Preserve ranking order from grouped results
    return grouped.map(g => ({
      product:   products.find(p => p.id === g.product_id),
      totalSold: g._sum.quantity || 0,
    }));
  }

  /**
   * Returns products where stock_quantity is at or below their individual low_stock_threshold.
   * Uses a raw SQL query because Prisma cannot compare two columns in a where clause.
   *
   * @returns {Promise<object[]>}
   */
  async getLowStockAlerts() {
    return prisma.$queryRaw`
      SELECT
        p.id, p.name, p.sku, p.stock_quantity, p.low_stock_threshold,
        c.name AS category_name,
        b.name AS brand_name
      FROM "Product" p
      LEFT JOIN "Category" c ON p.category_id = c.id
      LEFT JOIN "Brand"    b ON p.brand_id    = b.id
      WHERE p.is_active = true
        AND p.stock_quantity <= p.low_stock_threshold
      ORDER BY p.stock_quantity ASC
    `;
  }

  /** @private */
  async #countLowStockProducts() {
    const result = await prisma.$queryRaw`
      SELECT COUNT(*)::int AS count
      FROM "Product"
      WHERE is_active = true
        AND stock_quantity <= low_stock_threshold
    `;
    return result[0]?.count ?? 0;
  }
}
```

---

### 2.6 Product Repository — Full Prisma Queries

```js
// src/features/admin/repositories/productRepository.js
import prisma from '../../../config/prisma.js';

export class ProductRepository {
  /**
   * @param {{ skip?: number, take?: number, where?: object, orderBy?: object }} opts
   * @returns {Promise<object[]>}
   */
  async findAll({ skip = 0, take = 20, where = {}, orderBy = { created_at: 'desc' } } = {}) {
    return prisma.product.findMany({
      skip,
      take,
      where,
      orderBy,
      include: {
        category: { select: { id: true, name: true, slug: true } },
        brand:    { select: { id: true, name: true, logo_url: true } },
      },
    });
  }

  /**
   * @param {object} [where={}]
   * @returns {Promise<number>}
   */
  async count(where = {}) {
    return prisma.product.count({ where });
  }

  /**
   * Returns a single product with full relations including last 10 stock log entries.
   *
   * @param {string} id
   * @returns {Promise<object|null>}
   */
  async findById(id) {
    return prisma.product.findUnique({
      where: { id },
      include: {
        category:  true,
        brand:     true,
        stockLogs: {
          orderBy: { created_at: 'desc' },
          take:    10,
        },
      },
    });
  }

  /**
   * @param {string} slug
   * @returns {Promise<object|null>}
   */
  async findBySlug(slug) {
    return prisma.product.findUnique({ where: { slug } });
  }

  /**
   * @param {object} data
   * @returns {Promise<object>}
   */
  async create(data) {
    return prisma.product.create({ data });
  }

  /**
   * @param {string} id
   * @param {object} data
   * @returns {Promise<object>}
   */
  async update(id, data) {
    return prisma.product.update({ where: { id }, data });
  }

  /**
   * Soft delete — sets is_active = false.
   * Preserves the row for order history integrity.
   *
   * @param {string} id
   * @returns {Promise<object>}
   */
  async softDelete(id) {
    return prisma.product.update({
      where: { id },
      data:  { is_active: false },
    });
  }
}
```

---

### 2.7 Product Controller — Full Implementation

```js
// src/features/admin/controllers/productController.js
import { ProductService }  from '../services/productService.js';
import prisma from '../../../config/prisma.js';

const site = {
  name:    process.env.SITE_NAME    || 'Kishor Enterprises',
  tagline: process.env.SITE_TAGLINE || 'Official Electronics Store',
};

export class ProductController {
  constructor() {
    this.productService = new ProductService();
  }

  /**
   * GET /admin/products
   * Lists products with pagination and optional search/filter.
   */
  async index(req, res) {
    try {
      const page       = parseInt(req.query.page)  || 1;
      const limit      = parseInt(req.query.limit) || 20;
      const search     = req.query.search     || undefined;
      const categoryId = req.query.categoryId || undefined;
      const isActive   = req.query.isActive !== undefined
        ? req.query.isActive === 'true'
        : undefined;

      const { products, total, totalPages } = await this.productService.getAllProducts({
        page, limit, search, categoryId, isActive,
      });

      const categories = await prisma.category.findMany({
        where:   { is_active: true },
        orderBy: { name: 'asc' },
        select:  { id: true, name: true },
      });

      res.render('admin/products/index', {
        products,
        pagination: { page, limit, total, totalPages },
        categories,
        filters: { search, categoryId, isActive },
        currentPage: 'products',
        query: req.query,
        site,
        user: req.user,
      });
    } catch (error) {
      this.#handleError(req, res, error);
    }
  }

  /**
   * GET /admin/products/new
   * Renders the create-product form with dropdown data pre-loaded.
   */
  async newForm(req, res) {
    try {
      const [categories, brands] = await Promise.all([
        prisma.category.findMany({ where: { is_active: true }, orderBy: { name: 'asc' } }),
        prisma.brand.findMany(   { where: { is_active: true }, orderBy: { name: 'asc' } }),
      ]);

      res.render('admin/products/form', {
        product: null, // null = create mode in the template
        categories,
        brands,
        currentPage: 'products',
        query: req.query,
        site,
        user: req.user,
      });
    } catch (error) {
      this.#handleError(req, res, error);
    }
  }

  /**
   * POST /admin/products
   * Creates a new product and redirects to the product list.
   */
  async create(req, res) {
    try {
      // images may arrive as comma-separated string from a single input
      let images = req.body.images || [];
      if (typeof images === 'string') {
        images = images.split(',').map(u => u.trim()).filter(Boolean);
      }

      // specs arrives as a JSON string from a textarea
      let specs = req.body.specs || {};
      if (typeof specs === 'string') {
        try { specs = JSON.parse(specs); } catch { specs = {}; }
      }

      await this.productService.createProduct({ ...req.body, images, specs });
      res.redirect('/admin/products?success=Product+created+successfully');
    } catch (error) {
      this.#handleError(req, res, error, 'admin/products/form');
    }
  }

  /**
   * GET /admin/products/:id/edit
   * Renders the edit form pre-filled with the existing product.
   */
  async editForm(req, res) {
    try {
      const product = await this.productService.getProductById(req.params.id);
      const [categories, brands] = await Promise.all([
        prisma.category.findMany({ where: { is_active: true }, orderBy: { name: 'asc' } }),
        prisma.brand.findMany(   { where: { is_active: true }, orderBy: { name: 'asc' } }),
      ]);

      res.render('admin/products/form', {
        product, // non-null = edit mode in the template
        categories,
        brands,
        currentPage: 'products',
        query: req.query,
        site,
        user: req.user,
      });
    } catch (error) {
      this.#handleError(req, res, error);
    }
  }

  /**
   * PUT /admin/products/:id
   * Updates an existing product.
   */
  async update(req, res) {
    try {
      let images = req.body.images || [];
      if (typeof images === 'string') {
        images = images.split(',').map(u => u.trim()).filter(Boolean);
      }
      let specs = req.body.specs || {};
      if (typeof specs === 'string') {
        try { specs = JSON.parse(specs); } catch { specs = {}; }
      }

      await this.productService.updateProduct(req.params.id, { ...req.body, images, specs });
      res.redirect('/admin/products?success=Product+updated+successfully');
    } catch (error) {
      this.#handleError(req, res, error);
    }
  }

  /**
   * DELETE /admin/products/:id
   * Soft-deletes a product (sets is_active = false).
   */
  async destroy(req, res) {
    try {
      await this.productService.deleteProduct(req.params.id);

      // Support both page redirects (form submit) and fetch() JSON calls
      if (req.headers.accept?.includes('application/json')) {
        return res.json({ success: true, message: 'Product deactivated' });
      }
      res.redirect('/admin/products?success=Product+deleted');
    } catch (error) {
      this.#handleError(req, res, error);
    }
  }

  /**
   * Centralised error handler for all ProductController actions.
   * Responds with JSON for XHR requests; re-renders an error view for page requests.
   *
   * @private
   */
  #handleError(req, res, error, fallbackView = 'admin/error') {
    console.error('[ProductController]', error.message);
    const statusCode = error.statusCode || 500;

    if (req.headers.accept?.includes('application/json')) {
      return res.status(statusCode).json({ success: false, message: error.message });
    }
    return res.status(statusCode).render(fallbackView, {
      message:     error.message,
      product:     null,
      categories:  [],
      brands:      [],
      currentPage: 'products',
      query:       req.query,
      site,
      user: req.user,
    });
  }
}
```

---

### 2.8 Order Status Transition Rules

#### State Machine Diagram

```
              ┌────────────┐
   ┌──────────│  PENDING   │──────────────────────────┐
   │          └─────┬──────┘                          │
   │                │ confirm                          │ cancel
   │                ▼                                  ▼
   │         ┌────────────┐                    ┌────────────┐
   │         │ CONFIRMED  │────────────────────│ CANCELLED  │ (terminal)
   │         └─────┬──────┘     cancel         └────────────┘
   │               │ process                          ▲
   │               ▼                                  │ cancel
   │        ┌─────────────┐                           │
   │        │ PROCESSING  │───────────────────────────┘
   │        └──────┬──────┘
   │               │ ship
   │               ▼
   │          ┌─────────┐
   │          │ SHIPPED │
   │          └────┬────┘
   │               │ deliver
   │               ▼
   │         ┌───────────┐
   │         │ DELIVERED │
   │         └─────┬─────┘
   │               │ refund
   │               ▼
   │        ┌──────────────┐
   └───────▶│   REFUNDED   │ (terminal)
            └──────────────┘
```

#### Valid Transitions Object

```js
// Copy this directly into orderService.js
const VALID_TRANSITIONS = {
  PENDING:    ['CONFIRMED', 'CANCELLED'],
  CONFIRMED:  ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['SHIPPED', 'CANCELLED'],
  SHIPPED:    ['DELIVERED'],
  DELIVERED:  ['REFUNDED'],
  CANCELLED:  [],   // terminal
  REFUNDED:   [],   // terminal
};
```

#### Rules Summary Table

| From | Allowed Next States | Notes |
|------|---------------------|-------|
| `PENDING` | `CONFIRMED`, `CANCELLED` | New order awaiting admin confirmation |
| `CONFIRMED` | `PROCESSING`, `CANCELLED` | Payment verified; being packed |
| `PROCESSING` | `SHIPPED`, `CANCELLED` | Dispatched to courier |
| `SHIPPED` | `DELIVERED` | Courier has the parcel |
| `DELIVERED` | `REFUNDED` | Only refundable after delivery |
| `CANCELLED` | *(none)* | Terminal state — no further changes |
| `REFUNDED` | *(none)* | Terminal state — no further changes |

---

### 2.9 Admin EJS Layout (`frontend/views/admin/layout.ejs`)

**Setup required in `server.js`** (install first: `npm i express-ejs-layouts`):

```js
import expressLayouts from 'express-ejs-layouts';
app.use(expressLayouts);
app.set('layout', 'admin/layout');
app.set('layout extractScripts', true);
app.set('layout extractStyles', true);
```

**`frontend/views/admin/layout.ejs`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>
    <%= typeof title !== 'undefined' ? title : 'Admin Panel' %> — <%= site.name %>
  </title>

  <link rel="stylesheet" href="/assets/css/variables.css" />
  <link rel="stylesheet" href="/assets/css/base.css" />
  <link rel="stylesheet" href="/assets/css/admin.css" />

  <%- typeof style !== 'undefined' ? style : '' %>
</head>
<body class="admin-layout">

  <!-- ────────────────────── Sidebar ──────────────────────────── -->
  <aside class="admin-sidebar" id="adminSidebar">

    <div class="admin-sidebar__brand">
      <a href="/admin" class="admin-sidebar__logo">
        <span class="admin-sidebar__logo-icon" aria-hidden="true">⚡</span>
        <span class="admin-sidebar__logo-text"><%= site.name %></span>
      </a>
    </div>

    <nav class="admin-sidebar__nav" aria-label="Admin navigation">
      <ul class="admin-sidebar__list">

        <%
          const navItems = [
            { key: 'dashboard',  href: '/admin',            icon: '📊', label: 'Dashboard'  },
            { key: 'products',   href: '/admin/products',   icon: '📦', label: 'Products'   },
            { key: 'categories', href: '/admin/categories', icon: '🗂️', label: 'Categories' },
            { key: 'orders',     href: '/admin/orders',     icon: '🛒', label: 'Orders'     },
            { key: 'customers',  href: '/admin/customers',  icon: '👥', label: 'Customers'  },
            { key: 'inventory',  href: '/admin/inventory',  icon: '🏭', label: 'Inventory'  },
            { key: 'banners',    href: '/admin/banners',    icon: '🖼️', label: 'Banners'    },
          ];
        %>

        <% navItems.forEach(item => { %>
          <li class="admin-sidebar__item">
            <a
              href="<%= item.href %>"
              class="admin-sidebar__link <%= currentPage === item.key ? 'admin-sidebar__link--active' : '' %>"
              aria-current="<%= currentPage === item.key ? 'page' : 'false' %>"
            >
              <span class="admin-sidebar__icon" aria-hidden="true"><%= item.icon %></span>
              <span><%= item.label %></span>
            </a>
          </li>
        <% }); %>

      </ul>
    </nav>

  </aside>

  <!-- ────────────────────── Main area ────────────────────────── -->
  <div class="admin-main">

    <!-- Top navbar -->
    <header class="admin-topbar">
      <button
        class="admin-topbar__toggle"
        id="sidebarToggle"
        aria-label="Toggle sidebar"
        aria-expanded="true"
        aria-controls="adminSidebar"
      >☰</button>

      <div class="admin-topbar__right">
        <span class="admin-topbar__user" aria-label="Logged in as">
          👤 <%= typeof user !== 'undefined' && user ? (user.email || 'Admin') : 'Admin' %>
        </span>
        <form action="/logout" method="POST" style="display:inline;">
          <button type="submit" class="admin-topbar__logout">Logout</button>
        </form>
      </div>
    </header>

    <!-- Flash messages (passed as req.query from controller) -->
    <% if (typeof query !== 'undefined' && query) { %>
      <% if (query.success) { %>
        <div class="admin-flash admin-flash--success" role="alert" aria-live="polite">
          ✅ <%= query.success %>
        </div>
      <% } %>
      <% if (query.error) { %>
        <div class="admin-flash admin-flash--error" role="alert" aria-live="assertive">
          ❌ <%= query.error %>
        </div>
      <% } %>
    <% } %>

    <!-- Page body injected here by express-ejs-layouts -->
    <main class="admin-content" id="mainContent" tabindex="-1">
      <%- body %>
    </main>

  </div><!-- /.admin-main -->

  <script src="/assets/js/admin.js"></script>
  <%- typeof script !== 'undefined' ? script : '' %>

</body>
</html>
```

> Every controller render call must include `query: req.query` so the layout can display flash messages from query-string redirects.

---

### 2.10 Key Validation Rules

#### Product

| Field | Rule |
|-------|------|
| `name` | Required · 3–200 characters |
| `sku` | Required · unique · only alphanumeric and hyphens (`/^[a-zA-Z0-9-]+$/`) |
| `price` | Required · must be `> 0` · stored as `Decimal(10,2)` |
| `mrp` | Required · must be `>= price` · stored as `Decimal(10,2)` |
| `stock_quantity` | Required · integer `>= 0` |
| `category_id` | Required · must reference an existing active `Category` |
| `brand_id` | Required · must reference an existing active `Brand` |
| `images` | Optional · array of URL strings |
| `specs` | Optional · must be parseable as a JSON key-value object |

#### Category

| Field | Rule |
|-------|------|
| `name` | Required · unique · 2–100 characters |
| `slug` | Auto-generated from `name`; check for uniqueness before saving |
| `parent_id` | Optional · if provided, must exist in `Category` · cannot self-reference |

#### Banner

| Field | Rule |
|-------|------|
| `title` | Required · 2–100 characters |
| `image_url` | Required · must be a valid URL string |
| `display_order` | Integer `>= 0`; controls render order on the homepage |

#### Order Status Update

| Rule | Detail |
|------|--------|
| Only valid transitions allowed | Enforced by `VALID_TRANSITIONS` map — throws 400 otherwise |
| Terminal states cannot transition | `CANCELLED` and `REFUNDED` arrays are empty — any update throws 400 |
| `newStatus` must be a known enum value | Validated against `Object.keys(VALID_TRANSITIONS)` before map lookup |

#### Customer Block / Unblock

| Rule | Detail |
|------|--------|
| Cannot block an `ADMIN` user | Check `targetUser.role !== 'ADMIN'` before toggling |
| Blocked users cannot log in | `LoginService` must check `user.is_blocked === true` before issuing token |

---

### 2.11 Error Handling Pattern

All admin controllers follow this identical try/catch structure. It handles both JSON API calls (`fetch()` from `admin.js`) and regular EJS page requests transparently.

```js
// Standard pattern — paste into every controller action
try {
  // ... your logic
} catch (error) {
  console.error('[ControllerName]', error.message);

  // XHR / fetch calls from admin.js expect JSON
  if (req.headers.accept?.includes('application/json')) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  }

  // Full-page EJS requests get an error view
  return res.status(error.statusCode || 500).render('admin/error', {
    message:     error.message,
    currentPage: '',
    query:       req.query,
    site,
    user: req.user,
  });
}
```

Custom errors thrown from services should carry a `statusCode` property:

```js
// In any service
const err = new Error('Product not found');
err.statusCode = 404;
throw err;
```

This pattern means the controller never needs to import `http-errors` or any error-class library.

---

### 2.12 Server.js Integration

Add exactly these two lines to `server.js` in the positions shown:

```js
// At the top with other imports
import adminRoutes from './src/features/admin/routes/adminRoutes.js';

// After the existing app.use("/api", profileRoutes) line
app.use('/admin', adminRoutes);
```

Full relevant section of `server.js` after the addition:

```js
// Authentication Routes
app.use('/', authRoutes);

// Profile API Routes
app.use('/api', profileRoutes);

// Admin Panel Routes
app.use('/admin', adminRoutes);
```

No other changes to `server.js` are needed unless you also install `express-ejs-layouts` (see section 2.9).

---

## 3. Implementation Order

Follow this sequence. Each step builds on the previous one.

- [ ] **1. Prisma schema** — Add `Category`, `Brand`, `Product`, `Order`, `OrderItem`, `StockLog`, `Banner` models plus `is_blocked` field on `User` and the `orders` relation.
- [ ] **2. Migrate** — Run `npx prisma migrate dev --name add-admin-models` and verify the migration succeeds.
- [ ] **3. Seed data** (optional but helpful) — Create a seed script with a few categories, brands, and one admin user (`role: 'ADMIN'`).
- [ ] **4. `adminMiddleware.js`** — Implement `requireAuth` and `requireAdmin` as shown in section 2.1.
- [ ] **5. Repositories** — Implement all five repository classes (`productRepository`, `categoryRepository`, `orderRepository`, `customerRepository`, `bannerRepository`). These only contain Prisma calls — no business logic.
- [ ] **6. Services** — Implement all seven service classes. Start with `productService` (most complex) then work outward. Services import repositories and `prisma` directly for transactions.
- [ ] **7. Controllers** — Implement all seven controller classes. Each controller imports its corresponding service. Follow the `#handleError` pattern from section 2.11.
- [ ] **8. `adminRoutes.js`** — Wire all controllers into the router with `router.use(requireAuth, requireAdmin)` at the top.
- [ ] **9. `server.js`** — Add `app.use('/admin', adminRoutes)` as shown in section 2.12.
- [ ] **10. EJS layout** — Create `frontend/views/admin/layout.ejs` (section 2.9). Install `express-ejs-layouts` if using the layout helper.
- [ ] **11. EJS page templates** — Implement views in this order: `dashboard.ejs` → `products/index.ejs` → `products/form.ejs` → `orders/index.ejs` → `orders/detail.ejs` → remaining pages.
- [ ] **12. `admin.css`** — Style the sidebar, topbar, flash messages, data tables, and forms. Follow the CSS variable convention from `variables.css`.
- [ ] **13. `admin.js`** — Add client-side logic: sidebar toggle, `fetch()`-based PUT/DELETE calls for delete buttons and status updates, form validation feedback.
- [ ] **14. End-to-end testing** — Test each module manually: login as ADMIN → visit `/admin` → CRUD through each section → verify order status transitions respect the state machine.

---

*End of Admin Panel Technical Design Document*
