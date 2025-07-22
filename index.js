const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const admin = require('firebase-admin');
const app = express();
const port = process.env.PORT || 5000;

require('dotenv').config();

// Initialize Firebase Admin
const serviceAccount = require('./firebase-service-account.json');

// Middleware
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// MongoDB Connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.qs97klu.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});
async function run() {
  try {
    await client.connect();
    
    const db = client.db('Damaloy');
    const usersCollection = db.collection('users');
    const vendorCollection = db.collection('vendor');
    const productsCollection = db.collection('products');
    const adsCollection = db.collection('ads');
    const ordersCollection = db.collection('orders');
    const cartCollection = db.collection('cart');
    const watchlistsCollection = db.collection('watchlists');
    const reviewsCollection = db.collection('reviews');
    const paymentCollection =db.collection("payment")

    

     const verifyFBToken = async (req, res, next) => {
            const authHeader = req.headers.authorization;
            if (!authHeader) {
                return res.status(401).send({ message: 'unauthorized access' })
            }
            const token = authHeader.split(' ')[1];
            if (!token) {
                return res.status(401).send({ message: 'unauthorized access' })
            }

            // verify the token
            try {
                const decoded = await admin.auth().verifyIdToken(token);
                req.decoded = decoded;
                next();
            }
            catch (error) {
                return res.status(403).send({ message: 'forbidden access' })
            }
        }


        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email }
            const user = await usersCollection.findOne(query);
            if (!user || user.role !== 'Admin') {
                return res.status(403).send({ message: 'forbidden access' })
            }
            next();
        }

         const verifyvendor = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email }
            const user = await usersCollection.findOne(query);
            if (!user || user.role !== 'vendor') {
                return res.status(403).send({ message: 'forbidden access' })
            }
            next();
        }

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Payment Intent Creation
app.post('/create-payment-intent', async (req, res) => {
  const { amount } = req.body;
  
  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: parseInt(amount), 
      currency: 'usd',
      payment_method_types: ['card'],
    });
    
    res.send({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id
    });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// Create Order Endpoint - Fixed to match frontend data structure
app.post('/api/orders', async (req, res) => {
  try {
    const { 
      email, 
      items, 
      totalAmount, 
      deliveryOption, 
      paymentMethod, 
      subtotal, 
      deliveryFee,
      contactInfo,
      status = 'pending'
    } = req.body;
    
    // Generate unique order ID
    const orderId = 'ORD-' + Date.now().toString().slice(-8) + Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    
    const orderData = {
      orderId, // Add orderId to the document
      userEmail: email, // Keep userEmail for backend consistency
      email, // Also keep email for frontend compatibility
      items: items.map(item => ({
        productId: item.productId,
        productName: item.productName,
        price: item.price,
        quantity: item.quantity,
        photo: item.photo,
        marketName: item.marketName,
        productDescription: item.productDescription,
        totalPrice: item.totalPrice
      })),
      subtotal: subtotal || items.reduce((sum, item) => sum + item.totalPrice, 0),
      deliveryFee: deliveryFee || (deliveryOption === 'express' ? 100 : deliveryOption === 'next-day' ? 150 : 50),
      deliveryOption,
      paymentMethod,
      totalAmount,
      status,
      paymentStatus: status === 'paid' ? 'paid' : 'pending',
      contactInfo: contactInfo || { email, phone: '' },
      statusHistory: [
        {
          status: 'created',
          timestamp: new Date(),
          message: 'Order created successfully'
        }
      ],
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    const result = await ordersCollection.insertOne(orderData);
    
    res.status(201).json({
      success: true,
      orderId: orderData.orderId,
      data: { ...orderData, _id: result.insertedId }
    });
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to create order',
      error: error.message 
    });
  }
});


app.get('/api/orders', async (req, res) => {
  try {
    const { email, status, limit = 50, page = 1 } = req.query;
    
    let query = {};
    if (email) {
      // Query both userEmail and email fields for compatibility
      query.$or = [
        { userEmail: email },
        { email: email }
      ];
    }
    if (status) {
      query.status = status;
    }
    
    const options = {
      sort: { createdAt: -1 },
      limit: parseInt(limit),
      skip: (parseInt(page) - 1) * parseInt(limit)
    };
    
    const orders = await ordersCollection.find(query, options).toArray();
    const totalOrders = await ordersCollection.countDocuments(query);
    
    res.json({
      success: true,
      data: orders,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalOrders,
        totalPages: Math.ceil(totalOrders / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to fetch orders' 
    });
  }
});

// Get Single Order by ID or Order ID - Fixed response structure
app.get('/api/orders/:id', async (req, res) => {
  try {
    let query;
    
    // Check if the ID is a valid ObjectId
    if (ObjectId.isValid(req.params.id) && req.params.id.length === 24) {
      query = { _id: new ObjectId(req.params.id) };
    } else {
      // Assume it's an orderId
      query = { orderId: req.params.id };
    }
    
    const order = await ordersCollection.findOne(query);
    
    if (!order) {
      return res.status(404).json({ 
        success: false,
        message: 'Order not found' 
      });
    }
    
    // Return order data directly (not wrapped in data property) to match frontend expectations
    res.json(order);
  } catch (error) {
    console.error('Error fetching order:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to fetch order' 
    });
  }
});

// Update Order Status
app.patch('/api/orders/:id', async (req, res) => {
  try {
    const { status, paymentDetails, statusMessage } = req.body;
    
    let query;
    if (ObjectId.isValid(req.params.id) && req.params.id.length === 24) {
      query = { _id: new ObjectId(req.params.id) };
    } else {
      query = { orderId: req.params.id };
    }
    
    const updateData = {
      updatedAt: new Date()
    };
    
    if (status) {
      updateData.status = status;
      if (status === 'paid') {
        updateData.paymentStatus = 'paid';
      }
    }
    
    if (paymentDetails) {
      updateData.paymentDetails = paymentDetails;
    }
    
    // Add to status history
    const order = await ordersCollection.findOne(query);
    if (order) {
      const newStatusEntry = {
        status: status || order.status,
        timestamp: new Date(),
        message: statusMessage || `Order status updated to ${status}`
      };
      
      updateData.statusHistory = [...(order.statusHistory || []), newStatusEntry];
    }
    
    const result = await ordersCollection.updateOne(query, { $set: updateData });
    
    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Order updated successfully'
    });
  } catch (error) {
    console.error('Error updating order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update order'
    });
  }
});

// Payment Recording with Order Update - Fixed to handle frontend data properly
app.post('/payments', async (req, res) => {
  try {
    const { 
      orderId, 
      email, 
      amount, 
      paymentMethod, 
      transactionId, 
      paymentIntentId,
      status = 'paid'
    } = req.body;
    
    const paymentDoc = {
      orderId,
      email,
      amount,
      paymentMethod,
      transactionId,
      paymentIntentId,
      status,
      paymentDate: new Date(),
      createdAt: new Date()
    };
    
    const paymentResult = await paymentsCollection.insertOne(paymentDoc);
    
    // Update order status and add payment details
    const orderUpdateResult = await ordersCollection.updateOne(
      { orderId },
      { 
        $set: { 
          status: 'paid', 
          paymentStatus: 'paid',
          paymentDetails: {
            paymentId: paymentResult.insertedId,
            paymentIntentId,
            transactionId,
            paymentMethod,
            paidAt: new Date()
          },
          updatedAt: new Date()
        },
        $push: {
          statusHistory: {
            status: 'payment_received',
            timestamp: new Date(),
            message: 'Payment successfully processed'
          }
        }
      }
    );
    
    res.status(201).json({
      success: true,
      paymentId: paymentResult.insertedId,
      orderUpdated: orderUpdateResult.modifiedCount > 0,
      message: 'Payment recorded successfully'
    });
  } catch (error) {
    console.error('Payment processing failed:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to record payment',
      error: error.message 
    });
  }
});

// Get Payment History - Fixed query compatibility
app.get('/payments', async (req, res) => {
  try {
    const userEmail = req.query.email;
    
    // Remove JWT verification check if not implemented
    // if (req.decoded && req.decoded.email !== userEmail) {
    //   return res.status(403).send({ message: 'Forbidden access' });
    // }
    
    const query = userEmail ? { email: userEmail } : {};
    const options = { sort: { paymentDate: -1 } };
    
    const payments = await paymentsCollection.find(query, options).toArray();
    
    res.json({
      success: true,
      data: payments
    });
  } catch (error) {
    console.error('Error fetching payment history:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to get payments' 
    });
  }
});

// Add route to get order confirmation details for frontend
app.get('/user/orders/confirmation/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    
    const order = await ordersCollection.findOne({ orderId });
    
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }
    
    // Return order with success flag
    res.json({
      success: true,
      data: order
    });
  } catch (error) {
    console.error('Error fetching order confirmation:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch order confirmation'
    });
  }
});


        app.post('/users', async (req, res) => {
        const { email, displayName, photoURL } = req.body;
  
        const userExists = await usersCollection.findOne({ email });
        if (userExists) {
        return res.status(200).send({ message: 'User already exists', inserted: false });
        }

        const newUser = {
        email,
        displayName: displayName || null,
         photoURL: photoURL || null,
         role: 'user',
        created_at: new Date().toISOString(),
        last_log_in: new Date().toISOString()
        };

        const result = await usersCollection.insertOne(newUser);
        res.send(result);
        });

  
 app.get('/users', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 5;
    const skip = (page - 1) * limit;
    const searchQuery = req.query.search || '';

    // Build the search query
    const query = {};
    if (searchQuery) {
      query.$or = [
        { displayName: { $regex: searchQuery, $options: 'i' } },
        { email: { $regex: searchQuery, $options: 'i' } }
      ];
    }

    const total = await usersCollection.countDocuments(query);
    const users = await usersCollection.find(query)
      .skip(skip)
      .limit(limit)
      .toArray();

    res.send({ 
      success: true, 
      data: users,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Error getting users:', error);
    res.status(500).send({ success: false, message: 'Failed to get users' });
  }
});

// PATCH: Update user role (only allow user->vendor changes)
app.patch('/users/:id', async (req, res) => {
    try {
        const userId = req.params.id;
        const { role } = req.body;

        // Validate the ID
        if (!ObjectId.isValid(userId)) {
            return res.status(400).send({ message: 'Invalid user ID' });
        }

        // Find the current user
        const user = await usersCollection.findOne({ _id: new ObjectId(userId) });
        if (!user) {
            return res.status(404).send({ message: 'User not found' });
        }

        // Only allow changing from 'user' to 'vendor'
        if (user.role !== 'user' || role !== 'vendor') {
            return res.status(400).send({ 
                message: 'Role can only be changed from "user" to "vendor"',
                validRoles: {
                    from: 'user',
                    to: 'vendor'
                }
            });
        }

        // Update the role
        const result = await usersCollection.updateOne(
            { _id: new ObjectId(userId) },
            { $set: { role: 'vendor' } }
        );

        if (result.modifiedCount === 0) {
            return res.status(400).send({ message: 'No changes made' });
        }

        res.send({ 
            success: true,
            message: 'User role updated to vendor successfully',
            userId,
            previousRole: user.role,
            newRole: 'vendor'
        });

    } catch (error) {
        console.error('Error updating user role:', error);
        res.status(500).send({ message: 'Failed to update user role' });
    }
});
         // GET: Get user role by email
        app.get('/users/:email/role', async (req, res) => {
            try {
                const email = req.params.email;

                if (!email) {
                    return res.status(400).send({ message: 'Email is required' });
                }

                const user = await usersCollection.findOne({ email });

                if (!user) {
                    return res.status(404).send({ message: 'User not found' });
                }

                res.send({ role: user.role || 'user' });
            } catch (error) {
                console.error('Error getting user role:', error);
                res.status(500).send({ message: 'Failed to get role' });
            }
        });





        // vendor data 

        app.post('/vendor', async (req, res) => {
        try {
        const vendor = req.body;
        const result = await vendorCollection.insertOne(vendor);
        
        // Update the user's role to 'vendor'
        if (vendor.email) {
            await usersCollection.updateOne(
                { email: vendor.email },
                { $set: { role: 'vendor' } }
            );
        }
        
        res.send(result);
        } catch (error) {
        console.error('Error creating vendor:', error);
        res.status(500).send({ message: 'Failed to create vendor' });
      }
      })
         

      app.get('/vendor', async (req, res) => {
    try {
        const vendors = await vendorCollection.find().toArray();
        res.send(vendors);
    } catch (error) {
        console.error('Error getting all vendors:', error);
        res.status(500).send({ message: 'Failed to get vendors' });
    }
});

     app.get('/vendor/:email', async (req, res) => {
    try {
        const email = req.params.email;
        
        if (!email) {
            return res.status(400).send({ message: 'Email is required' });
        }

        const vendor = await vendorCollection.findOne({ email });

        if (!vendor) {
            return res.status(404).send({ message: 'Vendor not found' });
        }

        res.send(vendor);
    } catch (error) {
        console.error('Error getting vendor data:', error);
        res.status(500).send({ message: 'Failed to get vendor data' });
    }
});
    


// Create product
app.post('/products', async (req, res) => {
  try {
    const productData = req.body;
    const requiredFields = ['itemName', 'marketName', 'price', 'date'];
    const missingFields = requiredFields.filter(field => !productData[field]);

    if (missingFields.length > 0) {
      return res.status(400).json({ 
        success: false,
        message: 'Missing required fields',
        missingFields
      });
    }

    if (isNaN(productData.price) || productData.price <= 0) {
      return res.status(400).json({ 
        success: false,
        message: 'Price must be a positive number'
      });
    }
    
    // Verify vendor exists
    if (productData.vendorId) {
      const vendor = await vendorCollection.findOne({ _id: new ObjectId(productData.vendorId) });
      if (!vendor) {
        return res.status(400).json({ message: 'Vendor not found' });
      }
    } else if (productData.email) {
      const vendor = await vendorCollection.findOne({ email: productData.email });
      if (!vendor) {
        return res.status(400).json({ message: 'Vendor not found' });
      }
      productData.vendorId = vendor._id;
    } else {
      return res.status(400).json({ message: 'Vendor information is required' });
    }

     productData.prices = [{
      price: productData.price,
      date: new Date().toISOString(),
      updatedBy: productData.vendorId || 'system'
    }];

    // Add created_at timestamp
    productData.created_at = new Date().toISOString();
    
    const result = await productsCollection.insertOne(productData);
    res.status(201).json({
      message: 'Product created successfully',
      insertedId: result.insertedId
    });
  } catch (error) {
    console.error('Error creating product:', error);
    res.status(500).json({ message: 'Failed to create product' });
  }
});

// Update the existing /products endpoint
  app.get('/products', async (req, res) => {
  try {
    const { status, search, page = 1, limit = 100, sortBy, startDate, endDate } = req.query;
    const query = {};

    const parsedLimit = Math.min(parseInt(limit), 100); // Max 100 items per page
    const parsedPage = Math.max(parseInt(page), 1);
    
    if (status) query.status = status;
    
    if (search) {
      query.$or = [
        { itemName: { $regex: search, $options: 'i' } },
        { marketName: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } }
      ];
    }

// Update the /products endpoint date filtering logic
if (startDate) {
  // Convert to Date object and set to start of day
  const start = new Date(startDate);
  start.setUTCHours(0, 0, 0, 0);
  
  // Set end of the same day for exact date matching
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  
  query.date = { 
    $gte: start,
    $lt: end
  };
}

    const skip = (page - 1) * limit;
    
    // Build sort options
    let sortOption = {};
    switch(sortBy) {
      case 'price_low_high':
        sortOption = { price: 1 };
        break;
      case 'price_high_low':
        sortOption = { price: -1 };
        break;
      case 'newest':
        sortOption = { created_at: -1 };
        break;
      case 'oldest':
        sortOption = { created_at: 1 };
        break;
      default:
        sortOption = { created_at: -1 }; // Default sort by newest
    }

    const [products, total] = await Promise.all([
      productsCollection.find(query)
        .sort(sortOption)
        .skip(parseInt(skip))
        .limit(parseInt(limit))
        .toArray(),
      productsCollection.countDocuments(query)
    ]);
    
    res.json({
      success: true,
      data: products,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error getting products:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to get products' 
    });
  }
});


app.get('/products/:id', async (req, res) => {
  try {
    const productId = req.params.id;
    
    if (!ObjectId.isValid(productId)) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid product ID' 
      });
    }

    const product = await productsCollection.findOne({ 
      _id: new ObjectId(productId) 
    });

    if (!product) {
      return res.status(404).json({ 
        success: false,
        message: 'Product not found' 
      });
    }

    res.json({ 
      success: true,
      data: product 
    });
  } catch (error) {
    console.error('Error getting product:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to get product' 
    });
  }
});


// Update the PATCH /products/:id endpoint
app.patch('/products/:id', async (req, res) => {
  try {
    const productId = req.params.id;
    const updateData = req.body;
    const updatedBy = req.body.updatedBy || 'system'; // Get from auth later

    if (!ObjectId.isValid(productId)) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid product ID' 
      });
    }

    // Get current product first
    const currentProduct = await productsCollection.findOne({ 
      _id: new ObjectId(productId) 
    });

    if (!currentProduct) {
      return res.status(404).json({ 
        success: false,
        message: 'Product not found' 
      });
    }

    // Initialize prices array if it doesn't exist
    if (!currentProduct.prices) {
      currentProduct.prices = [];
    }

    // If price is being updated, add to history
    if (updateData.price && updateData.price !== currentProduct.price) {
      currentProduct.prices.push({
        price: currentProduct.price, // Store the old price
        date: currentProduct.updated_at || currentProduct.created_at,
        updatedBy: currentProduct.updatedBy || 'system'
      });

      // Keep only last 30 price changes (optional)
      if (currentProduct.prices.length > 30) {
        currentProduct.prices = currentProduct.prices.slice(-30);
      }

      // Add the price history to the update
      updateData.prices = currentProduct.prices;
    }

    // Add updated_at timestamp
    updateData.updated_at = new Date().toISOString();
    updateData.updatedBy = updatedBy;

    const result = await productsCollection.updateOne(
      { _id: new ObjectId(productId) },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ 
        success: false,
        message: 'Product not found after initial check' 
      });
    }

    const updatedProduct = await productsCollection.findOne({
      _id: new ObjectId(productId)
    });

    res.json({ 
      success: true,
      message: 'Product updated successfully',
      data: updatedProduct
    });
  } catch (error) {
    console.error('Error updating product:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to update product' 
    });
  }
});
// Delete product (FIXED missing forward slash)
app.delete('/products/:id', async (req, res) => {
  try {
    const productId = req.params.id;
    
    if (!ObjectId.isValid(productId)) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid product ID' 
      });
    }

    const result = await productsCollection.deleteOne({ 
      _id: new ObjectId(productId) 
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ 
        success: false,
        message: 'Product not found' 
      });
    }

    res.json({ 
      success: true,
      message: 'Product deleted successfully' 
    });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to delete product' 
    });
  }
});


// Add this new endpoint
app.get('/products/:id/price-history', async (req, res) => {
  try {
    const productId = req.params.id;
    
    if (!ObjectId.isValid(productId)) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid product ID' 
      });
    }

    const product = await productsCollection.findOne(
      { _id: new ObjectId(productId) },
      { projection: { prices: 1, itemName: 1, marketName: 1 } }
    );

    if (!product) {
      return res.status(404).json({ 
        success: false,
        message: 'Product not found' 
      });
    }

    // Format the response
    const response = {
      itemName: product.itemName,
      marketName: product.marketName,
      currentPrice: product.price,
      priceHistory: product.prices || []
    };

    res.json({ 
      success: true,
      data: response
    });
  } catch (error) {
    console.error('Error getting price history:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to get price history' 
    });
  }
});


// Advertisement Endpoints
app.post('/ads', async (req, res) => {
  try {
    const advertisement = {
      ...req.body,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await adsCollection.insertOne(advertisement);

    res.status(201).json({
      success: true,
      insertedId: result.insertedId,
      message: 'Advertisement created successfully'
    });
  } catch (error) {
    console.error('Error creating advertisement:', error);
    res.status(500).json({ success: false, message: 'Failed to create advertisement' });
  }
});

app.get('/ads', async (req, res) => {
  try {
    const { status, search, page = 1, limit = 10 } = req.query;
    const query = {};
    
    if (status) query.status = status;
    
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { targetAudience: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (page - 1) * limit;
    
    const [ads, total] = await Promise.all([
      adsCollection.find(query)
        .skip(parseInt(skip))
        .limit(parseInt(limit))
        .toArray(),
      adsCollection.countDocuments(query)
    ]);
    
    res.json({
      success: true,
      data: ads,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error getting advertisements:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to get advertisements' 
    });
  }
});

app.get('/ads/:id', async (req, res) => {
  try {
    const adId = req.params.id;
    
    if (!ObjectId.isValid(adId)) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid advertisement ID' 
      });
    }

    const ad = await adsCollection.findOne({ 
      _id: new ObjectId(adId) 
    });

    if (!ad) {
      return res.status(404).json({ 
        success: false,
        message: 'Advertisement not found' 
      });
    }

    res.json({ 
      success: true,
      data: ad 
    });
  } catch (error) {
    console.error('Error getting advertisement:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to get advertisement' 
    });
  }
});

app.patch('/ads/:id', async (req, res) => {
  try {
    const adId = req.params.id;
    const updateData = req.body;

    if (!ObjectId.isValid(adId)) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid advertisement ID' 
      });
    }

    // Prevent certain fields from being updated
    const restrictedFields = ['_id', 'createdAt', 'vendorId'];
    for (const field of restrictedFields) {
      if (updateData[field]) {
        delete updateData[field];
      }
    }

    // Add updated timestamp
    updateData.updatedAt = new Date();

    const result = await adsCollection.updateOne(
      { _id: new ObjectId(adId) },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ 
        success: false,
        message: 'Advertisement not found' 
      });
    }

    // Get the updated ad to return
    const updatedAd = await adsCollection.findOne({
      _id: new ObjectId(adId)
    });

    res.json({ 
      success: true,
      message: 'Advertisement updated successfully',
      data: updatedAd
    });
  } catch (error) {
    console.error('Error updating advertisement:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to update advertisement' 
    });
  }
});

app.delete('/ads/:id', async (req, res) => {
  try {
    const adId = req.params.id;
    
    if (!ObjectId.isValid(adId)) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid advertisement ID' 
      });
    }

    const result = await adsCollection.deleteOne({ 
      _id: new ObjectId(adId) 
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ 
        success: false,
        message: 'Advertisement not found' 
      });
    }

    res.json({ 
      success: true,
      message: 'Advertisement deleted successfully' 
    });
  } catch (error) {
    console.error('Error deleting advertisement:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to delete advertisement' 
    });
  }
});




// watchlist



// Add to watchlist
// Add to watchlist
app.post('/user/watchlist', async (req, res) => {
    try {
        const { email, productId } = req.body;
        
        // Validate input
        if (!email || !productId) {
            return res.status(400).json({ message: 'Email and productId are required' });
        }

        // Check if product exists
        const product = await productsCollection.findOne({ _id: new ObjectId(productId) });
        if (!product) {
            return res.status(404).json({ message: 'Product not found' });
        }

        // Check if already in watchlist
        const existingItem = await watchlistsCollection.findOne({
            userEmail: email,
            productId: new ObjectId(productId)
        });

        if (existingItem) {
            return res.status(400).json({ message: 'Product already in watchlist' });
        }

        const watchlistItem = {
            userEmail: email,
            productId: new ObjectId(productId),
            addedAt: new Date()
        };

        const result = await watchlistsCollection.insertOne(watchlistItem);
        res.status(201).json({ 
            message: 'Product added to watchlist',
            insertedId: result.insertedId 
        });
    } catch (error) {
        console.error('Error adding to watchlist:', error);
        res.status(500).json({ message: 'Failed to add to watchlist' });
    }
});

// Get user's watchlist
app.get('/user/watchlist', async (req, res) => {
    try {
        const { email } = req.query;
        
        if (!email) {
            return res.status(400).json({ message: 'Email is required' });
        }

        const watchlist = await watchlistsCollection
            .aggregate([
                { $match: { userEmail: email } },
                {
                    $lookup: {
                        from: 'products',
                        localField: 'productId',
                        foreignField: '_id',
                        as: 'product'
                    }
                },
                { $unwind: '$product' },
                {
                    $project: {
                        _id: 1,
                        userEmail: 1,
                        productId: 1,
                        addedAt: 1,
                        product: {
                            _id: '$product._id',
                            itemName: '$product.itemName',
                            price: '$product.price',
                            photo: '$product.photo',
                            marketName: '$product.marketName',
                            vendorName: '$product.vendorName',
                            description: '$product.description',
                            status: '$product.status',
                            date: '$product.date',
                            created_at: '$product.created_at'
                        }
                    }
                },
                { $sort: { addedAt: -1 } } // Sort by newest first
            ])
            .toArray();

        res.json(watchlist);
    } catch (error) {
        console.error('Error fetching watchlist:', error);
        res.status(500).json({ message: 'Failed to fetch watchlist' });
    }
});

// Remove from watchlist
app.delete('/user/watchlist/:productId', async (req, res) => {
    try {
        const { email } = req.body;
        const { productId } = req.params;
        
        if (!email) {
            return res.status(400).json({ message: 'Email is required' });
        }

        if (!productId) {
            return res.status(400).json({ message: 'Product ID is required' });
        }

        // Validate ObjectId format
        if (!ObjectId.isValid(productId)) {
            return res.status(400).json({ message: 'Invalid product ID format' });
        }

        const result = await watchlistsCollection.deleteOne({
            userEmail: email,
            productId: new ObjectId(productId)
        });

        if (result.deletedCount === 0) {
            return res.status(404).json({ message: 'Item not found in watchlist' });
        }

        res.json({ message: 'Product removed from watchlist successfully' });
    } catch (error) {
        console.error('Error removing from watchlist:', error);
        res.status(500).json({ message: 'Failed to remove from watchlist' });
    }
});

// Check if product is in watchlist (optional utility endpoint)
app.get('/user/watchlist/check/:productId', async (req, res) => {
    try {
        const { email } = req.query;
        const { productId } = req.params;
        
        if (!email) {
            return res.status(400).json({ message: 'Email is required' });
        }

        if (!ObjectId.isValid(productId)) {
            return res.status(400).json({ message: 'Invalid product ID format' });
        }

        const existingItem = await watchlistsCollection.findOne({
            userEmail: email,
            productId: new ObjectId(productId)
        });

        res.json({ 
            isInWatchlist: !!existingItem,
            addedAt: existingItem?.addedAt || null
        });
    } catch (error) {
        console.error('Error checking watchlist status:', error);
        res.status(500).json({ message: 'Failed to check watchlist status' });
    }
});

// Get watchlist count for user (optional utility endpoint)
app.get('/user/watchlist/count', async (req, res) => {
    try {
        const { email } = req.query;
        
        if (!email) {
            return res.status(400).json({ message: 'Email is required' });
        }

        const count = await watchlistsCollection.countDocuments({ userEmail: email });
        res.json({ count });
    } catch (error) {
        console.error('Error getting watchlist count:', error);
        res.status(500).json({ message: 'Failed to get watchlist count' });
    }
});


// Add to cart
app.post('/user/cart', async (req, res) => {
  try {
    console.log('Received body:', req.body); // Debug log
    
    const { email, productId, quantity = 1 } = req.body;
    
    // Validate input
    if (!email || !productId) {
      return res.status(400).json({ 
        success: false,
        message: 'Email and productId are required',
        receivedBody: req.body
      });
    }

    // Check if product exists
    const product = await productsCollection.findOne({ _id: new ObjectId(productId) });
    if (!product) {
      return res.status(404).json({ 
        success: false,
        message: 'Product not found'
      });
    }

    // Check if product already in cart
    const existingCartItem = await cartCollection.findOne({
      userEmail: email,
      'product._id': new ObjectId(productId)
    });

    if (existingCartItem) {
      return res.status(400).json({ 
        success: false,
        message: 'Product already in cart'
      });
    }

    // Create cart item
    const cartItem = {
      userEmail: email,
      product,
      quantity,
      addedAt: new Date()
    };

    const result = await cartCollection.insertOne(cartItem);

    res.status(201).json({ 
      success: true,
      message: 'Product added to cart',
      insertedId: result.insertedId
    });

  } catch (error) {
    console.error('Cart endpoint error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});


// Get user's cart
app.get('/user/cart', async (req, res) => {
  try {
    const { email } = req.query;
    
    if (!email) {
      return res.status(400).json({ 
        success: false,
        message: 'Email is required' 
      });
    }

    const cartItems = await cartCollection
      .find({ userEmail: email })
      .sort({ addedAt: -1 })
      .toArray();

    res.json({ 
      success: true,
      data: cartItems 
    });
  } catch (error) {
    console.error('Error fetching cart:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to fetch cart items' 
    });
  }
});

// Update cart item quantity
app.patch('/user/cart/:productId', async (req, res) => {
  try {
    const { email, quantity } = req.body;
    const { productId } = req.params;
    
    if (!email || !productId || quantity === undefined) {
      return res.status(400).json({ 
        success: false,
        message: 'Email, productId and quantity are required' 
      });
    }

    if (quantity < 1) {
      return res.status(400).json({ 
        success: false,
        message: 'Quantity must be at least 1' 
      });
    }

    const result = await cartCollection.updateOne(
      { 
        userEmail: email,
        'product._id': new ObjectId(productId)
      },
      { $set: { quantity } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ 
        success: false,
        message: 'Cart item not found' 
      });
    }

    res.json({ 
      success: true,
      message: 'Cart item updated',
      modifiedCount: result.modifiedCount
    });
  } catch (error) {
    console.error('Error updating cart:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to update cart item' 
    });
  }
});

// Remove from cart
app.delete('/user/cart/:productId', async (req, res) => {
  try {
    const { email } = req.body;
    const { productId } = req.params;
    
    if (!email) {
      return res.status(400).json({ 
        success: false,
        message: 'Email is required' 
      });
    }

    const result = await cartCollection.deleteOne({
      userEmail: email,
      'product._id': new ObjectId(productId)
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ 
        success: false,
        message: 'Item not found in cart' 
      });
    }

    res.json({ 
      success: true,
      message: 'Product removed from cart',
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('Error removing from cart:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to remove from cart' 
    });
  }
});


// Clear user's cart endpoint
app.delete('/user/cart/clear', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ 
      success: false,
      message: 'Email is required' 
    });
  }

  try {
    // Assuming you have a cart collection in your database
    const result = await cartsCollection.deleteMany({ 
      userEmail: email 
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ 
        success: false,
        message: 'No cart items found for this user' 
      });
    }

    res.json({ 
      success: true,
      message: 'Cart cleared successfully',
      deletedCount: result.deletedCount 
    });
  } catch (error) {
    console.error('Error clearing cart:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to clear cart',
      error: error.message 
    });
  }
});



// Review Endpoints
app.post('/reviews/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    const { rating, comment, priceAssessment, user } = req.body;
    
    // Basic validation
    if (!rating || !comment || !priceAssessment || !user) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    if (rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }
    
    const newReview = {
      productId,
      rating: parseInt(rating),
      comment,
      priceAssessment,
      user: {
        name: user.name || 'Anonymous',
        email: user.email,
        avatar: user.avatar || null
      },
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    const result = await reviewsCollection.insertOne(newReview);
    const createdReview = await reviewsCollection.findOne({ _id: result.insertedId });
    
    res.status(201).json(createdReview);
  } catch (error) {
    console.error('Error creating review:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get reviews for a specific product
app.get('/reviews/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    
    const reviews = await reviewsCollection.find({ productId })
      .sort({ createdAt: -1 }) // newest first
      .toArray();
    
    res.json(reviews);
  } catch (error) {
    console.error('Error fetching reviews:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update a user's review
app.put('/user/reviews/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { rating, comment, priceAssessment, productId } = req.body;
    
    // Basic validation
    if (!rating || !comment || !priceAssessment) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const updateData = {
      rating: parseInt(rating),
      comment,
      priceAssessment,
      productId,
      updatedAt: new Date()
    };
    
    const result = await reviewsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Review not found' });
    }
    
    const updatedReview = await reviewsCollection.findOne({ _id: new ObjectId(id) });
    res.json(updatedReview);
  } catch (error) {
    console.error('Error updating review:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete a user's review
app.delete('/user/reviews/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await reviewsCollection.deleteOne({ _id: new ObjectId(id) });
    
    if (result.deletedCount === 1) {
      res.json({ success: true, message: 'Review deleted successfully' });
    } else {
      res.status(404).json({ success: false, error: 'Review not found' });
    }
  } catch (error) {
    console.error('Error deleting review:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

    // ==================== ERROR HANDLING ====================
    app.use((err, req, res, next) => {
      console.error('Unhandled error:', err);
      res.status(500).json({ message: 'Internal server error' });
    });

    app.use((req, res) => {
      res.status(404).json({ message: 'Not found' });
    });

    // await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } catch (error) {
    console.error('Server startup error:', error);
    process.exit(1);
  }
}

run().catch(console.dir);


app.get("/", (req, res) => {
  res.send("Damaloy API is running successfully!")
})

app.listen(port, () => {
  console.log(`Damaloy API is running on port ${port}`)
})