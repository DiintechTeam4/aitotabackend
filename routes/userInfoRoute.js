const express = require("express");
const router = express.Router();
const {
  getAppUsers,
  getContacts,
  getGroupContacts,
} = require("../controllers/userInfoController");

router.get("/users", getAppUsers);
router.get("/contacts", getContacts);
router.get("/group-contacts", getGroupContacts);

module.exports = router;


