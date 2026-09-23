import { AdminProductRepository } from '../repositories/AdminProductRepository.js';

export class AdminProductService {
  constructor() {
    this.repository = new AdminProductRepository();
  }

  /**
   * List products with filters and pagination
   * Query params: search, category, page (default 1), limit (default 20)
   */
  async list(filters = {}) {
    try {
      const where = {};

      // Search by product name, description, or brand
      if (filters.search) {
        where.OR = [
          { name: { contains: filters.search, mode: 'insensitive' } },
          { description: { contains: filters.search, mode: 'insensitive' } },
          { brand: { contains: filters.search, mode: 'insensitive' } }
        ];
      }

      // Filter by category
      if (filters.category && filters.category !== 'all') {
        where.category = {
          name: { contains: filters.category, mode: 'insensitive' }
        };
      }

      // Pagination
      const page = Math.max(1, parseInt(filters.page) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(filters.limit) || 20));
      const skip = (page - 1) * limit;

      const { products, total } = await this.repository.findAll(where, skip, limit);

      return {
        success: true,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        },
        count: products.length,
        data: products
      };
    } catch (err) {
      const error = new Error(`Failed to fetch products: ${err.message}`);
      error.status = 500;
      throw error;
    }
  }

  /**
   * Create a new product
   * Required: name, description, brand, price, categoryId, slug
   * Optional: availability
   */
  async create(data) {
    try {
      // Validate required fields
      if (!data.name || !data.description || !data.brand || !data.price || !data.categoryId || !data.slug) {
        const error = new Error('Missing required fields: name, description, brand, price, categoryId, slug');
        error.status = 400;
        throw error;
      }

      // Validate price is a positive number
      const price = parseFloat(data.price);
      if (isNaN(price) || price <= 0) {
        const error = new Error('Price must be a positive number');
        error.status = 400;
        throw error;
      }

      // Check if slug already exists
      const slugExists = await this.repository.findBySlug(data.slug);
      if (slugExists) {
        const error = new Error('Product slug already exists');
        error.status = 409;
        throw error;
      }

      // Check if category exists
      const categoryExists = await this.repository.categoryExists(data.categoryId);
      if (!categoryExists) {
        const error = new Error('Category not found');
        error.status = 404;
        throw error;
      }

      // Create product
      const product = await this.repository.create({
        name: data.name,
        description: data.description,
        brand: data.brand,
        price: data.price,
        categoryId: data.categoryId,
        slug: data.slug,
        availability: data.availability || 'AVAILABLE'
      });

      return {
        success: true,
        message: 'Product created successfully',
        data: product
      };
    } catch (err) {
      const error = err.status ? err : new Error(`Failed to create product: ${err.message}`);
      if (!error.status) error.status = 500;
      throw error;
    }
  }

  /**
   * Update a product
   */
  async update(id, data) {
    try {
      // Check if product exists
      const existing = await this.repository.findById(id);
      if (!existing) {
        const error = new Error('Product not found');
        error.status = 404;
        throw error;
      }

      // Validate price if being updated
      if (data.price !== undefined) {
        const price = parseFloat(data.price);
        if (isNaN(price) || price <= 0) {
          const error = new Error('Price must be a positive number');
          error.status = 400;
          throw error;
        }
      }

      // If slug is being updated, check for duplicates
      if (data.slug && data.slug !== existing.slug) {
        const slugExists = await this.repository.findBySlug(data.slug);
        if (slugExists) {
          const error = new Error('Product slug already exists');
          error.status = 409;
          throw error;
        }
      }

      // If categoryId is being updated, check if category exists
      if (data.categoryId && data.categoryId !== existing.categoryId) {
        const categoryExists = await this.repository.categoryExists(data.categoryId);
        if (!categoryExists) {
          const error = new Error('Category not found');
          error.status = 404;
          throw error;
        }
      }

      const product = await this.repository.update(id, data);

      return {
        success: true,
        message: 'Product updated successfully',
        data: product
      };
    } catch (err) {
      const error = err.status ? err : new Error(`Failed to update product: ${err.message}`);
      if (!error.status) error.status = 500;
      throw error;
    }
  }

  /**
   * Delete a product
   */
  async remove(id) {
    try {
      // Check if product exists
      const existing = await this.repository.findById(id);
      if (!existing) {
        const error = new Error('Product not found');
        error.status = 404;
        throw error;
      }

      await this.repository.remove(id);

      return {
        success: true,
        message: 'Product deleted successfully'
      };
    } catch (err) {
      const error = err.status ? err : new Error(`Failed to delete product: ${err.message}`);
      if (!error.status) error.status = 500;
      throw error;
    }
  }

  /**
   * Toggle product visibility (AVAILABLE ↔ NOT_AVAILABLE)
   */
  async toggleVisibility(id) {
    try {
      const product = await this.repository.findById(id);

      if (!product) {
        const error = new Error('Product not found');
        error.status = 404;
        throw error;
      }

      const newAvailability = product.availability === 'AVAILABLE' ? 'NOT_AVAILABLE' : 'AVAILABLE';

      const updated = await this.repository.update(id, {
        availability: newAvailability
      });

      return {
        success: true,
        message: `Product availability changed to ${newAvailability}`,
        data: updated
      };
    } catch (err) {
      const error = err.status ? err : new Error(`Failed to toggle visibility: ${err.message}`);
      if (!error.status) error.status = 500;
      throw error;
    }
  }
}
