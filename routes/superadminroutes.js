const express = require('express');
const { loginSuperadmin, registerSuperadmin, getAdmins, getClients, deleteAdmin, deleteClient, registerAdmin, registerClient } = require('../controllers/superadmincontroller');
const { verifySuperadminToken } = require('../middlewares/authmiddleware');

const router = express.Router();

router.post('/login', loginSuperadmin);
router.post('/register', registerSuperadmin);

// All these routes require superadmin token
router.get('/getadmins', verifySuperadminToken, getAdmins);
router.get('/getclients', verifySuperadminToken, getClients);
router.delete('/deleteadmin/:id', verifySuperadminToken, deleteAdmin);
router.delete('/deleteclient/:id', verifySuperadminToken, deleteClient);
router.post('/registeradmin', verifySuperadminToken, registerAdmin);
router.post('/registerclient', verifySuperadminToken, registerClient);

module.exports = router;