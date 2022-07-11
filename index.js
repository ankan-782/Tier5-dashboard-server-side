const express = require('express');
const { MongoClient, ServerApiVersion } = require('mongodb');
const ObjectId = require('mongodb').ObjectId;
const admin = require("firebase-admin");
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

admin.initializeApp({
    credential: admin.credential.cert({
        type: process.env.FIREBASE_TYPE,
        project_id: process.env.FIREBASE_PROJECT_ID,
        private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
        private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        client_id: process.env.FIREBASE_CLIENT_ID,
        auth_uri: process.env.FIREBASE_AUTH_URI,
        token_uri: process.env.FIREBASE_TOKEN_URI,
        auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
        client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL
    })
});


//middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.wipcb.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

async function verifyToken(req, res, next) {
    if (req?.headers?.authorization?.startsWith('Bearer ')) {
        const token = req.headers.authorization.split(' ')[1];

        try {
            const decodedUser = await admin.auth().verifyIdToken(token);
            req.decodedEmail = decodedUser.email;
        } catch {

        }
    }
    next();
}

async function run() {
    try {
        await client.connect();
        console.log('connected successfully');
        const database = client.db("tier5_dashboard_DB");
        const users = database.collection("users");

        //storing the users to database [brand new users]
        app.post('/users', async (req, res) => {
            const email = req.body.email;
            const query = { email: email };
            const existingUser = await users.findOne(query);
            if (existingUser) {
                res.json({ message: 'This User is already registerd' })
            }
            else {
                const user = req.body;
                const result = await users.insertOne(user);
                res.json(result);
            }
        });

        //set the admin role 
        app.put('/users/admin', verifyToken, async (req, res) => {
            const user = req.body;
            const requester = req.decodedEmail;
            if (requester) {
                const requesterAccount = await users.findOne({ email: requester });
                if (requesterAccount.role === 'admin') {
                    const filter = { email: user.email };
                    const existingUser = await users.findOne(filter);
                    if (existingUser.role) {
                        res.json({ message: 'This User is already admin' })
                    }
                    else {
                        const updateDoc = { $set: { role: 'admin' } };
                        const result = await users.updateOne(filter, updateDoc);
                        res.json(result);
                    }
                }
                else {
                    res.status(403).json({ message: 'You do not have access to make admin' })
                }
            }

        });

        //checking the admin
        app.get('/users/:email', async (req, res) => {
            const email = req.params.email;
            const query = { email: email };
            const user = await users.findOne(query);
            let isAdmin = false
            if (user?.role === 'admin') {
                isAdmin = true;
            }
            res.json({ admin: isAdmin });
        });

    } finally {
        // await client.close();
    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('hello from node express')
})

app.listen(port, () => {
    console.log('listening to port', port);
})