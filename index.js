const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const connectDB = require('./config/db');
const axios = require('axios');
const superadminRoutes = require('./routes/superadminroutes')
const adminRoutes = require('./routes/adminroutes');
const clientRoutes = require('./routes/clientroutes')
const profileRoutes = require('./routes/profileroutes')

const app = express();

dotenv.config();

// Increase payload size limit to handle audio data
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.use(cors());

app.get('/', (req,res)=>{
    res.send("hello world")
})
app.post('/api/v1/client/proxy/clicktobot', async (req, res) => {
    try {
      const { apiKey, payload } = req.body;
      console.log(req.body)
      
      const response = await axios.post(
        'https://3neysomt18.execute-api.us-east-1.amazonaws.com/dev/clicktobot',
        payload,
        {
          headers: {
            'X-CLIENT': 'czobd',
            'X-API-KEY': apiKey,
            'Content-Type': 'application/json',
          },
        }
      );
  
      res.json({
        success: true,
        data: response.data
      });
    } catch (error) {
      console.error('Proxy error:', error.response?.data || error.message);
      res.status(500).json({
        success: false,
        error: error.response?.data || error.message
      });
    }
  });
app.use('/api/v1/superadmin',superadminRoutes);
app.use('/api/v1/admin',adminRoutes);
app.use('/api/v1/client',clientRoutes);
app.use('/api/v1/auth/client/profile', profileRoutes);


const PORT = 4000 || process.env.PORT;

connectDB().then(
app.listen(PORT,()=>{
console.log(`server is running on http://localhost:${PORT}`)
})
)

