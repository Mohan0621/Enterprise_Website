import prisma from '../../../config/prisma.js';

export class AdminProductRepository {
  /**
   * Find all products with category and primary image
   */
  async findAll(where = {}, skip = 0, take = 20, orderBy = { createdAt: 'desc' }) {
    const products = await prisma.product.findMany({
      where,
      skip,
      take,
      orderBy,
      select: {
        id: true,
        name: true,
        description: true,
        brand: true,
        price: true,
        stock: true,
        availability: true,
        slug: true,
        createdAt: true,
        updatedAt: true,
        category: {
          select: {
            id: true,
            name: true
          }
        },
        productImages: {
          where: { isPrimary: true },
          select: {
            id: true,
            imageUrl: true
          },
          take: 1
        },
        _count: {
          select: {
            variants: true,
            orderItems: true
          }
        }
      }
    });

    // Get total count for pagination
    const total = await prisma.product.count({ where });

    return {
      products: products.map(p => ({
        ...p,
        variantsCount: p._count.variants,
        primaryImage: p.productImages[0] || null,
        _count: undefined
      })),
      total
    };
  }

  /**
   * Find product by ID with all relations
   */
  async findById(id) {
    return prisma.product.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        description: true,
        brand: true,
        price: true,
        stock: true,
        availability: true,
        slug: true,
        createdAt: true,
        updatedAt: true,
        category: {
          select: {
            id: true,
            name: true
          }
        },
        productImages: {
          select: {
            id: true,
            imageUrl: true,
            isPrimary: true
          }
        },
        _count: {
          select: {
            variants: true,
            orderItems: true
          }
        }
      }
    });
  }

  /**
   * Find product by slug
   */
  async findBySlug(slug) {
    return prisma.product.findUnique({
      where: { slug }
    });
  }

  /**
   * Create a new product
   */
  async create(data) {
    return prisma.product.create({
      data,
      select: {
        id: true,
        name: true,
        description: true,
        brand: true,
        price: true,
        availability: true,
        slug: true,
        createdAt: true,
        updatedAt: true,
        categoryId: true
      }
    });
  }

  /**
   * Update product by ID
   */
  async update(id, data) {
    return prisma.product.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        description: true,
        brand: true,
        price: true,
        stock: true,
        availability: true,
        slug: true,
        createdAt: true,
        updatedAt: true,
        category: {
          select: {
            id: true,
            name: true
          }
        },
        productImages: {
          select: {
            id: true,
            imageUrl: true,
            isPrimary: true
          }
        },
        _count: {
          select: {
            variants: true,
            orderItems: true
          }
        }
      }
    });
  }

  /**
   * Delete product by ID
   */
  async remove(id) {
    return prisma.product.delete({
      where: { id }
    });
  }

  /**
   * Check if category exists
   */
  async categoryExists(categoryId) {
    return prisma.category.findUnique({
      where: { id: categoryId }
    });
  }
}
