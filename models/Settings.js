const mongoose = require("mongoose");

const settingsSchema = new mongoose.Schema({
  welcomeScreen: {
    type: Boolean,
    default: true,
  },
  contactUsButton: {
    type: Boolean,
    default: true,
  },
});

module.exports = mongoose.model("Settings", settingsSchema);


