const mongoose = require('mongoose');

const connectDB = async () => {
    try {
      await mongoose.connect(process.env.MONGODB_URI);
      console.log("mongodb conected")  
    } 
    catch (error) {
      console.error(`ERROR : ${error.message}`);
      process.exit(1);
    }
};

module.exports = connectDB