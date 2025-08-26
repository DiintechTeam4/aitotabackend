const express = require("express");
const { loginAdmin, registerAdmin, getClients, getClientById, deleteclient, getClientToken, approveClient } = require("../controllers/admincontroller");
const { authMiddleware } = require("../middlewares/authmiddleware");
const planController = require("../controllers/planController");
const creditController = require("../controllers/creditController");
const couponController = require("../controllers/couponController");
const router = express.Router();

router.get("/", (req, res) => {
    res.status(200).json({message: "Hello admin"});
});
router.post("/login",loginAdmin);

router.post("/register",registerAdmin);

router.get("/getclients", getClients);

router.get("/getclientbyid/:id", getClientById);

router.delete('/deleteclient/:id', deleteclient);

router.get('/get-client-token/:clientId', authMiddleware, getClientToken);

router.post('/approve-client/:clientId', authMiddleware, approveClient);

// Plan Management Routes
router.post('/plans', authMiddleware, planController.createPlan);
router.get('/plans', authMiddleware, planController.getAllPlans);
router.get('/plans/stats', authMiddleware, planController.getPlanStats);
router.get('/plans/:id', authMiddleware, planController.getPlanById);
router.put('/plans/:id', authMiddleware, planController.updatePlan);
router.delete('/plans/:id', authMiddleware, planController.deletePlan);
router.patch('/plans/:id/toggle', authMiddleware, planController.togglePlanStatus);
router.post('/plans/:id/duplicate', authMiddleware, planController.duplicatePlan);

// Credit Management Routes
router.get('/credits', authMiddleware, creditController.getAllCreditRecords);
router.get('/credits/stats', authMiddleware, creditController.getCreditStats);
router.get('/credits/client/:clientId', authMiddleware, creditController.getClientBalance);
router.get('/credits/client/:clientId/history', authMiddleware, creditController.getCreditHistory);
router.post('/credits/purchase', authMiddleware, creditController.purchasePlan);
router.post('/credits/add', authMiddleware, creditController.addCredits);
router.post('/credits/use', authMiddleware, creditController.useCredits);
router.put('/credits/client/:clientId/settings', authMiddleware, creditController.updateCreditSettings);
router.post('/credits/validate-coupon', authMiddleware, creditController.validateCoupon);

// Coupon Management Routes
router.post('/coupons', authMiddleware, couponController.createCoupon);
router.post('/coupons/bulk', authMiddleware, couponController.bulkCreateCoupons);
router.get('/coupons', authMiddleware, couponController.getAllCoupons);
router.get('/coupons/stats', authMiddleware, couponController.getCouponStats);
router.get('/coupons/:id', authMiddleware, couponController.getCouponById);
router.get('/coupons/:id/usage', authMiddleware, couponController.getCouponUsageHistory);
router.put('/coupons/:id', authMiddleware, couponController.updateCoupon);
router.delete('/coupons/:id', authMiddleware, couponController.deleteCoupon);
router.patch('/coupons/:id/toggle', authMiddleware, couponController.toggleCouponStatus);
router.post('/coupons/validate', authMiddleware, couponController.validateCouponCode);

module.exports=router;
