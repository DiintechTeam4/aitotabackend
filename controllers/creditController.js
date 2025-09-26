const Credit = require("../models/Credit");
const Plan = require("../models/Plan");
const Coupon = require("../models/Coupon");
const Client = require("../models/Client");

// Get client credit balance
const getClientBalance = async (req, res) => {
  try {
    const { clientId } = req.params;
    
    const creditRecord = await Credit.findOne({ clientId })
      .populate("currentPlan.planId")
      .populate("history.planId", "name")
      .lean();

    if (!creditRecord) {
      return res.status(404).json({
        success: false,
        message: "Credit record not found"
      });
    }

    res.status(200).json({
      success: true,
      data: creditRecord
    });
  } catch (error) {
    console.error("Error fetching client balance:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch client balance",
      error: error.message
    });
  }
};

// Get all client credit records
const getAllCreditRecords = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      sortBy = "updatedAt", 
      sortOrder = "desc",
      search
    } = req.query;

    // Build filter
    const filter = {};
    // Efficient server-side search via Client lookup
    if (search && typeof search === 'string' && search.trim().length > 0) {
      const term = search.trim();
      try {
        const clients = await Client.find({
          $or: [
            { name: { $regex: term, $options: 'i' } },
            { email: { $regex: term, $options: 'i' } },
            { businessName: { $regex: term, $options: 'i' } },
          ]
        }).select('_id').limit(200).lean();
        const ids = clients.map(c => c._id);
        if (ids.length === 0) {
          return res.status(200).json({
            success: true,
            data: [],
            pagination: { page: parseInt(page), limit: parseInt(limit), total: 0, pages: 0 }
          });
        }
        filter.clientId = { $in: ids };
      } catch (e) {
        // If client lookup fails, fall back to no results rather than scanning all credits
        return res.status(200).json({
          success: true,
          data: [],
          pagination: { page: parseInt(page), limit: parseInt(limit), total: 0, pages: 0 }
        });
      }
    }

    // Build sort
    const sort = {};
    const allowedSortFields = new Set([
      'updatedAt',
      'currentBalance',
      'totalPurchased',
      'totalUsed'
    ]);
    const sortField = allowedSortFields.has(String(sortBy)) ? String(sortBy) : 'updatedAt';
    sort[sortField] = sortOrder === "desc" ? -1 : 1;

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [creditRecords, total] = await Promise.all([
      Credit.find(filter)
        .select({
          currentBalance: 1,
          totalPurchased: 1,
          totalUsed: 1,
          clientId: 1,
          updatedAt: 1,
          'currentPlan.planId': 1,
          'currentPlan.endDate': 1,
          'settings.lowBalanceAlert': 1,
        })
        .populate("clientId", "name email businessName")
        .populate("currentPlan.planId", "name price")
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Credit.countDocuments(filter)
    ]);

    res.status(200).json({
      success: true,
      data: creditRecords,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error("Error fetching credit records:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch credit records",
      error: error.message
    });
  }
};

// Purchase plan for client
const purchasePlan = async (req, res) => {
  try {
    const { clientId, planId, billingCycle, couponCode, autoRenew } = req.body;

    // Validate required fields
    if (!clientId || !planId) {
      return res.status(400).json({
        success: false,
        message: "Client ID and Plan ID are required"
      });
    }

    // Get plan
    const plan = await Plan.findById(planId);
    if (!plan || !plan.isActive) {
      return res.status(404).json({
        success: false,
        message: "Plan not found or inactive"
      });
    }

    // Get or create credit record
    let creditRecord = await Credit.getOrCreateCreditRecord(clientId);

    // Calculate price
    let finalPrice = plan.price;
    let discountApplied = 0;
    let couponUsed = null;

    // Apply billing cycle discount
    const cycleDiscount = plan.discounts[`${billingCycle}Discount`] || 0;
    if (cycleDiscount > 0) {
      discountApplied = (finalPrice * cycleDiscount) / 100;
      finalPrice -= discountApplied;
    }

    // Apply coupon if provided
    if (couponCode) {
      const coupon = await Coupon.findValidCoupon(couponCode);
      if (coupon && coupon.appliesToPlan(planId, plan.category)) {
        const couponDiscount = coupon.calculateDiscount(finalPrice);
        finalPrice -= couponDiscount;
        discountApplied += couponDiscount;
        couponUsed = coupon.code;
      }
    }

    // Calculate credits to add
    const creditsToAdd = plan.creditsIncluded + plan.bonusCredits;

    // Add credits to client account
    await creditRecord.addCredits(
      creditsToAdd,
      "purchase",
      `Plan purchase: ${plan.name} (${billingCycle})`,
      planId,
      `TXN_${Date.now()}`
    );

    // Update current plan information
    const startDate = new Date();
    let endDate = new Date();
    
    switch (billingCycle) {
      case "monthly":
        endDate.setMonth(endDate.getMonth() + 1);
        break;
      case "quarterly":
        endDate.setMonth(endDate.getMonth() + 3);
        break;
      case "yearly":
        endDate.setFullYear(endDate.getFullYear() + 1);
        break;
    }

    creditRecord.currentPlan = {
      planId: planId,
      startDate: startDate,
      endDate: endDate,
      billingCycle: billingCycle,
      autoRenew: autoRenew || false
    };

    await creditRecord.save();

    // Apply coupon usage if used
    if (couponUsed) {
      const coupon = await Coupon.findValidCoupon(couponCode);
      if (coupon) {
        await coupon.applyCoupon(clientId, planId, plan.price);
      }
    }

    res.status(200).json({
      success: true,
      message: "Plan purchased successfully",
      data: {
        plan: plan.name,
        creditsAdded: creditsToAdd,
        price: plan.price,
        discountApplied: discountApplied,
        finalPrice: finalPrice,
        billingCycle: billingCycle,
        startDate: startDate,
        endDate: endDate,
        couponUsed: couponUsed
      }
    });
  } catch (error) {
    console.error("Error purchasing plan:", error);
    res.status(500).json({
      success: false,
      message: "Failed to purchase plan",
      error: error.message
    });
  }
};

// Add credits manually (admin function)
const addCredits = async (req, res) => {
  try {
    const { clientId, amount, type, description } = req.body;

    if (!clientId || !amount || !type || !description) {
      return res.status(400).json({
        success: false,
        message: "Client ID, amount, type, and description are required"
      });
    }

    const creditRecord = await Credit.getOrCreateCreditRecord(clientId);
    
    await creditRecord.addCredits(
      amount,
      type,
      description,
      null,
      `ADMIN_${Date.now()}`
    );

    res.status(200).json({
      success: true,
      message: "Credits added successfully",
      data: {
        clientId,
        amount,
        type,
        newBalance: creditRecord.currentBalance
      }
    });
  } catch (error) {
    console.error("Error adding credits:", error);
    res.status(500).json({
      success: false,
      message: "Failed to add credits",
      error: error.message
    });
  }
};

// Use credits (for API calls)
const useCredits = async (req, res) => {
  try {
    const { clientId, amount, usageType, description, metadata } = req.body;

    if (!clientId || !amount || !usageType || !description) {
      return res.status(400).json({
        success: false,
        message: "Client ID, amount, usage type, and description are required"
      });
    }

    const creditRecord = await Credit.getOrCreateCreditRecord(clientId);
    
    await creditRecord.useCredits(amount, usageType, description, metadata);

    res.status(200).json({
      success: true,
      message: "Credits used successfully",
      data: {
        clientId,
        amount,
        usageType,
        newBalance: creditRecord.currentBalance
      }
    });
  } catch (error) {
    console.error("Error using credits:", error);
    res.status(500).json({
      success: false,
      message: "Failed to use credits",
      error: error.message
    });
  }
};

// Get credit usage history
const getCreditHistory = async (req, res) => {
  try {
    const { clientId } = req.params;
    const { page = 1, limit = 20, type } = req.query;

    const filter = { clientId };
    if (type) filter["history.type"] = type;

    const creditRecord = await Credit.findOne(filter)
      .populate("history.planId", "name")
      .lean();

    if (!creditRecord) {
      return res.status(404).json({
        success: false,
        message: "Credit record not found"
      });
    }

    // Filter and paginate history
    let history = creditRecord.history;
    if (type) {
      history = history.filter(h => h.type === type);
    }

    const total = history.length;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const paginatedHistory = history
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(skip, skip + parseInt(limit));

    res.status(200).json({
      success: true,
      data: {
        history: paginatedHistory,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error("Error fetching credit history:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch credit history",
      error: error.message
    });
  }
};

// Get credit statistics
const getCreditStats = async (req, res) => {
  try {
    const [
      totalClients,
      activeSubscriptions,
      totalCreditsPurchased,
      totalCreditsUsed,
      lowBalanceClients
    ] = await Promise.all([
      Credit.countDocuments(),
      Credit.countDocuments({ "currentPlan.planId": { $exists: true, $ne: null } }),
      Credit.aggregate([
        { $group: { _id: null, total: { $sum: "$totalPurchased" } } }
      ]),
      Credit.aggregate([
        { $group: { _id: null, total: { $sum: "$totalUsed" } } }
      ]),
      Credit.countDocuments({
        $expr: {
          $lte: ["$currentBalance", "$settings.lowBalanceAlert.threshold"]
        }
      })
    ]);

    res.status(200).json({
      success: true,
      data: {
        totalClients,
        activeSubscriptions,
        totalCreditsPurchased: totalCreditsPurchased[0]?.total || 0,
        totalCreditsUsed: totalCreditsUsed[0]?.total || 0,
        lowBalanceClients
      }
    });
  } catch (error) {
    console.error("Error fetching credit stats:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch credit statistics",
      error: error.message
    });
  }
};

// Update credit settings
const updateCreditSettings = async (req, res) => {
  try {
    const { clientId } = req.params;
    const { lowBalanceAlert, autoPurchase } = req.body;

    const creditRecord = await Credit.findOne({ clientId });
    if (!creditRecord) {
      return res.status(404).json({
        success: false,
        message: "Credit record not found"
      });
    }

    if (lowBalanceAlert) {
      creditRecord.settings.lowBalanceAlert = {
        ...creditRecord.settings.lowBalanceAlert,
        ...lowBalanceAlert
      };
    }

    if (autoPurchase) {
      creditRecord.settings.autoPurchase = {
        ...creditRecord.settings.autoPurchase,
        ...autoPurchase
      };
    }

    await creditRecord.save();

    res.status(200).json({
      success: true,
      message: "Credit settings updated successfully",
      data: creditRecord.settings
    });
  } catch (error) {
    console.error("Error updating credit settings:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update credit settings",
      error: error.message
    });
  }
};

// Validate coupon
const validateCoupon = async (req, res) => {
  try {
    const { couponCode, planId, clientId } = req.body;

    if (!couponCode || !planId) {
      return res.status(400).json({
        success: false,
        message: "Coupon code and plan ID are required"
      });
    }

    const coupon = await Coupon.findValidCoupon(couponCode);
    if (!coupon) {
      return res.status(404).json({
        success: false,
        message: "Invalid or expired coupon"
      });
    }

    const plan = await Plan.findById(planId);
    if (!plan) {
      return res.status(404).json({
        success: false,
        message: "Plan not found"
      });
    }

    // Check if coupon applies to plan
    if (!coupon.appliesToPlan(planId, plan.category)) {
      return res.status(400).json({
        success: false,
        message: "Coupon not applicable to this plan"
      });
    }

    // Check if user can use coupon
    const canUse = await coupon.canBeUsedBy(clientId);
    if (!canUse.valid) {
      return res.status(400).json({
        success: false,
        message: canUse.reason
      });
    }

    const discount = coupon.calculateDiscount(plan.price);

    res.status(200).json({
      success: true,
      message: "Coupon is valid",
      data: {
        coupon: {
          code: coupon.code,
          name: coupon.name,
          description: coupon.description,
          discountType: coupon.discountType,
          discountValue: coupon.discountValue
        },
        discount: discount,
        finalPrice: plan.price - discount
      }
    });
  } catch (error) {
    console.error("Error validating coupon:", error);
    res.status(500).json({
      success: false,
      message: "Failed to validate coupon",
      error: error.message
    });
  }
};

module.exports = {
  getClientBalance,
  getAllCreditRecords,
  purchasePlan,
  addCredits,
  useCredits,
  getCreditHistory,
  getCreditStats,
  updateCreditSettings,
  validateCoupon
};
