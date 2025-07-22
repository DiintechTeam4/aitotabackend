const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const connectDB = require('./config/db');

const superadminRoutes = require('./routes/superadminroutes')
const adminRoutes = require('./routes/adminroutes');
const clientRoutes = require('./routes/clientroutes')

const app = express();

dotenv.config();

app.use(express.json());

app.use(cors());

app.get('/', (req,res)=>{
    res.send("hello world")
})

app.use('/api/v1/superadmin',superadminRoutes);
app.use('/api/v1/admin',adminRoutes)
app.use('/api/v1/client',clientRoutes)



const PORT = 4000 || process.env.PORT;

connectDB().then(
app.listen(PORT,()=>{
console.log(`server is running on http://localhost:${PORT}`)
})
)


