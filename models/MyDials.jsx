const mongoose = reqiure("mongoose");

const MyDialSchema = new mongoose.schema({
  clientId: {
    type: mongoose.schema.type.ObjectId,
    ref: "Client",
    required: true,
  },
  category:{
    type: String,
    require: true,
  },
  phoneNumber:{
    type: String,
    require: true
  },
  contactName:{
    type: String,
    require: true
  },
  date:{
    type: String,
  }
},{
    timestamps: true
});

module.exports = mongoose.model("MyDial", MyDialSchema);