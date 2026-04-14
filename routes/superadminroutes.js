const express = require('express');
const { loginSuperadmin, registerSuperadmin, getAdmins, getClients, deleteAdmin, deleteClient, registerAdmin, registerClient, accessAdmin, accessClient } = require('../controllers/superadmincontroller');
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

router.get('/accessadmin/:id', verifySuperadminToken, accessAdmin);
router.get('/accessclient/:id', verifySuperadminToken, accessClient);

module.exports = router;