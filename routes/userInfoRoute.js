const express = require("express");
const router = express.Router();
const {
  getAppUsers,
  getContacts,
} = require("../controllers/userInfoController");

router.get("/users", getAppUsers);
router.get("/contacts", getContacts);

module.exports = router;


