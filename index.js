const express = require('express');
const cors = require('cors');
require('dotenv').config();
const app = express();
const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());

// test route
app.get('/', (req, res) => {
  res.send('Parcel Delivery Server is Running!');
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});