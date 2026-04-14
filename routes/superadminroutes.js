const express = require('express');
const { loginSuperadmin, registerSuperadmin, getAdmins, getClients, deleteAdmin, deleteClient, registerAdmin, registerClient } = require('../controllers/superadmincontroller');

const router = express.Router();

router.post('/login', loginSuperadmin);
router.post('/register', registerSuperadmin);
router.get('/getadmins', getAdmins);
router.get('/getclients', getClients);
router.delete('/deleteadmin/:id', deleteAdmin);
router.delete('/deleteclient/:id', deleteClient);
router.post('/registeradmin', registerAdmin);
router.post('/registerclient', registerClient);

module.exports = router;