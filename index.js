const express = require("express");
const cors = require("cors");
require("dotenv").config();
const app = express();
const Stripe = require("stripe");
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.a0ni9sf.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db("parcelDB");
    const parcelsCollection = db.collection("parcels");
    const transactionsCollection = db.collection("transactions");

    // GET parcels (all or by user email)
    app.get("/parcels", async (req, res) => {
      try {
        const email = req.query.email;

        // Build query based on email
        const query = email ? { created_by: email } : {};

        // Get parcels, sort by creation_date descending
        const parcels = await parcelsCollection
          .find(query)
          .sort({ creation_date: -1 }) // latest first
          .toArray();

        res.send(parcels);
      } catch (error) {
        console.error("Error fetching parcels:", error);
        res.status(500).send({ message: "Server Error" });
      }
    });

    // GET a single parcel by ID
    app.get("/parcels/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };

        const parcel = await parcelsCollection.findOne(query);

        if (parcel) {
          res.send(parcel);
        } else {
          res.status(404).send({ message: "Parcel not found" });
        }
      } catch (error) {
        console.error("Error fetching parcel:", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Create a new parcel
    app.post("/parcels", async (req, res) => {
      const newParcel = req.body;
      const result = await parcelsCollection.insertOne(newParcel);
      res.send(result);
    });

    // parcel delete
    app.delete("/parcels/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };

        const result = await parcelsCollection.deleteOne(query);

        res.send(result);
      } catch (error) {
        console.error("Error deleting parcel:", error);
        res.status(500).send({ success: false, message: "Server error" });
      }
    });

    app.post("/create-payment-intent", async (req, res) => {
      const { amount } = req.body;

      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount, // in cents (100 = $1)
          currency: "usd",
          payment_method_types: ["card"],
        });

        res.send({
          clientSecret: paymentIntent.client_secret,
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // record transaction history

    app.post("/payments", async (req, res) => {
      const { transactionId, amount, email, parcelId, paymentMethod } =
        req.body;

      try {
        // 1. Save transaction to DB
        const transaction = {
          transactionId,
          amount,
          email,
          parcelId,
          paymentMethod,
          createdAt: new Date(),
          createdAtString : new Date().toISOString()
        };
        await transactionsCollection.insertOne(transaction);

        // 2. Update parcel's payment status
        await parcelsCollection.updateOne(
          { _id: new ObjectId(parcelId) },
          { $set: { payment_status: "paid" } }
        );

        res.send({
          success: true,
          message: "Payment recorded & parcel updated",
        });
      } catch (err) {
        console.error(err);
        res.status(500).send({ error: "Failed to record payment" });
      }
    });

    app.get('/payments', async(req , res) =>{
      const email = req.query.email;
      const query = email ? {email} : {};
      const result = await transactionsCollection.find(query).toArray();
      res.send(result);
    })

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

// test route
app.get("/", (req, res) => {
  res.send("Parcel Delivery Server is Running!");
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
