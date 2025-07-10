const express = require("express");
const cors = require("cors");
require("dotenv").config();
const app = express();
const Stripe = require("stripe");
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");
const serviceAccount = require("./firebase-admin-key.json");

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// middleware
app.use(cors());
app.use(express.json());

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

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
    const usersCollection = db.collection("user");
    const parcelsCollection = db.collection("parcels");
    const transactionsCollection = db.collection("transactions");
    const trackCollection = db.collection("trackings");
    const ridersCollection = db.collection("riders");

    const verifyFBToken = async (req, res, next) => {
      // console.log('from middleware ', req.headers.authorization);
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).send({ message: "unauthorized access" });
      }

      const token = authHeader.split(" ")[1];
      if (!token) {
        return res.status(401).send({ message: "unauthorized access" });
      }

      // verify the token

      try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.decoded = decoded;
        next();
      } catch {
        return res.status(401).send({ message: "forbidden access" });
      }
    };

    const verifyEmail = async (req, res, next) => {
      if (req.decoded.email !== req.query.email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    app.post("/users", async (req, res) => {
      const user = req.body;
      const email = user.email;
      const query = { email };
      const userExist = await usersCollection.findOne(query);
      if (userExist) {
        const result = await usersCollection.updateOne(query, {
          $set: { last_login: user.last_login },
        });
        return res
          .status(200)
          .send({ message: "User already exist", inserted: false });
      }
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    // GET parcels (all or by user email)
    app.get("/parcels", verifyFBToken, verifyEmail, async (req, res) => {
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
    app.get("/parcels/:id", verifyFBToken, async (req, res) => {
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

    // for riders

    // get who pending
    app.get("/riders", async (req, res) => {
      const status = req.query.status;
      const query = status ? { status } : {};
      const riders = await ridersCollection.find(query).toArray();
      res.send(riders);
    });

    // riders application api
    app.post("/riders", async (req, res) => {
      const rider = req.body;
      const result = await ridersCollection.insertOne(rider);
      return res.send(result);
    });

    // riders status update
    app.patch("/riders/status/:id", async (req, res) => {
      const { id } = req.params;
      const { status } = req.body;
      const result = await ridersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status } }
      );
      res.send(result);
    });
    
    // payment related
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
          createdAtString: new Date().toISOString(),
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

    app.get("/payments", verifyFBToken, verifyEmail, async (req, res) => {
      const email = req.query.email;
      const query = email ? { email } : {};
      const result = await transactionsCollection
        .find(query)
        .sort({ createdAt: -1 })
        .toArray();
      res.send(result);
    });

    // for tracking collection / parcel

    app.get("/tracking", async (req, res) => {
      const { trackingId } = req.query;
      if (!trackingId)
        return res.status(400).json({ error: "Tracking ID is required" });

      const updates = await trackCollection
        .find({ trackingId })
        .sort({ timestamp: -1 }) // latest update first
        .toArray();

      if (!updates.length) {
        return res.status(404).json({ message: "No tracking updates found" });
      }

      res.json(updates);
    });

    app.post("/tracking", async (req, res) => {
      const {
        trackingId,
        status,
        message,
        location,
        updated_by = "",
      } = req.body;

      if (!trackingId || !status || !message || !location || !updated_by) {
        return res.status(400).json({ error: "All fields are required" });
      }

      const newUpdate = {
        trackingId,
        status, // e.g., 'collected', 'on_transit', 'on_the_way'
        message, // descriptive message
        location,
        updated_by,
        timestamp: new Date(),
      };

      try {
        const result = await trackCollection.insertOne(newUpdate);
        res.json({
          message: "Tracking update added successfully",
          insertedId: result.insertedId,
        });
      } catch (error) {
        console.error("Track insert error:", error);
        res.status(500).json({ error: "Failed to insert tracking update" });
      }
    });

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
