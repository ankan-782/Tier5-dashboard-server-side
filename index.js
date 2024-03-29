const express = require('express');
const { MongoClient, ServerApiVersion } = require('mongodb');
const ObjectId = require('mongodb').ObjectId;
const admin = require("firebase-admin");
const cors = require('cors');
const { auth } = require('firebase-admin');
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

//update user name and email information in firebase
const updateUserInFirebase = (existingUser, editedUserInfo) => {
    admin.auth().getUserByEmail(existingUser?.email)
        .then((userRecord) => {
            // See the UserRecord reference doc for the contents of userRecord.
            // console.log(`Successfully fetched user data: ${JSON.stringify(userRecord)}`);
            var stringifyUser = JSON.stringify(userRecord);
            var currentFirebaseUser = JSON.parse(stringifyUser);
            admin.auth().updateUser(currentFirebaseUser?.uid, {
                email: editedUserInfo?.email,
                emailVerified: true,
                displayName: editedUserInfo?.name,
                disabled: false,
            })
                .then((userRecord) => {
                    // See the UserRecord reference doc for the contents of userRecord.
                    // console.log('Successfully updated user', userRecord.toJSON());
                    console.log('Successfully updated user');
                })
                .catch((error) => {
                    console.log('Error updating user:', error);
                });
        })
        .catch((error) => {
            console.log('Error fetching user data:', error);
        });
}

//delete user information in firebase
const deleteUserInFirebase = (specificUser) => {
    admin.auth().getUserByEmail(specificUser?.email)
        .then((userRecord) => {
            // See the UserRecord reference doc for the contents of userRecord.
            // console.log(`Successfully fetched user data: ${JSON.stringify(userRecord)}`);
            var stringifyUser = JSON.stringify(userRecord);
            var currentFirebaseUser = JSON.parse(stringifyUser);
            admin.auth().deleteUser(currentFirebaseUser?.uid)
                .then(() => {
                    console.log('Successfully deleted user');
                })
                .catch((error) => {
                    console.log('Error deleting user:', error);
                });
        })
        .catch((error) => {
            console.log('Error fetching user data:', error);
        });
}

//create user information in firebase
const createUserInFirebase = (user) => {
    admin.auth().createUser({
        email: user?.email,
        emailVerified: false,
        password: user?.password,
        displayName: user?.name,
        disabled: false,
    })
        .then((userRecord) => {
            // See the UserRecord reference doc for the contents of userRecord.
            console.log('Successfully created new user:', userRecord.uid);
        })
        .catch((error) => {
            console.log('Error creating new user:', error);
        })
}

async function run() {
    try {
        await client.connect();
        console.log('connected successfully');
        const database = client.db("tier5_dashboard_DB");
        const users = database.collection("users");

        //can be updated both specific Users every infos and also can be updated only username (unique username)
        app.put('/users/update/:id', async (req, res) => {
            const editedUserInfo = req.body;
            const idOfEditedUserInfo = editedUserInfo._id;
            const filter = { _id: ObjectId(idOfEditedUserInfo) };
            const existingUser = await users.findOne(filter);

            //checking the user has unique username or not
            const queryForUsername = { username: editedUserInfo.username };
            const user = await users.findOne(queryForUsername);

            if (existingUser?.username === editedUserInfo?.username || user === null) {

                //update user name and email information in firebase
                updateUserInFirebase(existingUser, editedUserInfo);

                const options = { upsert: true };
                const updateDoc = {
                    $set: {
                        email: editedUserInfo.email,
                        username: editedUserInfo.username,
                        name: editedUserInfo.name,
                        age: editedUserInfo.age,
                        gender: editedUserInfo.gender,
                        country: editedUserInfo.country,
                        device: editedUserInfo.device,
                    }
                };

                const result = await users.updateOne(filter, updateDoc, options);
                res.json(result);
            }
            else {
                res.json({ message: 'This username is already taken' });
            }

        })

        //DELETE users from database
        app.delete("/users/delete/:id", async (req, res) => {
            const userId = req.params.id;
            const query = { _id: ObjectId(userId) };
            const specificUser = await users.findOne(query);

            //delete user information in firebase
            deleteUserInFirebase(specificUser);

            const result = await users.deleteOne(query);
            res.json(result);
        });

        //checking the admin
        app.get('/users/checkAdmin/:email', async (req, res) => {
            const email = req.params.email;
            const query = { email: email };
            const user = await users.findOne(query);
            let isAdmin = false
            if (user?.role === 'admin') {
                isAdmin = true;
            }
            res.json({ admin: isAdmin });
        });

        //load specific user info by id from users collection for updatation
        app.get('/users/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const specificUser = await users.findOne(query);
            res.send(specificUser);
        });


        //show all users to dashboard from database by server except admin user and sorting with dynamic property of users ascending and descending order
        app.get('/users', async (req, res) => {
            const page = req.query.page;
            const size = parseInt(req.query.size);
            const property = (req.query.property);
            const order = (req.query.order);
            var key = property,
                obj = {
                    [key]: order
                };
            const cursor = users.find({
                $or: [
                    { role: { $exists: false } }
                ]
            }).sort(obj);
        let allUsers;
        if (page) {
            allUsers = await cursor.skip(page * size).limit(size).toArray();
        }
        else {
            allUsers = await cursor.toArray();
        }
        res.json(allUsers);
    });

    //storing the users to database [brand new users]
    app.post('/users', async (req, res) => {
        const email = req.body.email;
        const query = { email: email };
        const existingUser = await users.findOne(query);
        if (existingUser) {
            res.json({ message: 'This User is already registerd' })
        }
        else {
            //checking the user has unique username or not
            const queryForUsername = { username: req?.body?.username };
            const userOfThatUnOrNull = await users.findOne(queryForUsername);
            if (userOfThatUnOrNull === null) {
                const user = req.body;
                const result = await users.insertOne(user);
                res.json(result);
            }
            else {
                res.json({ message: 'This Username is already taken' });
            }
        }
    });

    //storing the users to database and firebase [brand new users] from dashboard
    app.post('/users/addAnotherUser', verifyToken, async (req, res) => {
        const requester = req.decodedEmail;
        if (requester) {
            const requesterAccount = await users.findOne({ email: requester });
            if (requesterAccount.role === 'admin') {
                const email = req.body.email;
                const query = { email: email };
                const existingUser = await users.findOne(query);
                if (existingUser) {
                    res.json({ message: 'This User is already registerd' })
                }
                else {
                    //checking the user has unique username or not
                    const queryForUsername = { username: req?.body?.username };
                    const userOfThatUnOrNull = await users.findOne(queryForUsername);
                    if (userOfThatUnOrNull === null) {
                        //create user information in firebase
                        createUserInFirebase(req.body);

                        const user = {
                            email: req.body.email,
                            username: req.body.username,
                            name: req.body.name,
                            age: req.body.age,
                            gender: req.body.gender,
                            country: req.body.country,
                            device: req.body.device,
                        }
                        const result = await users.insertOne(user);
                        res.json(result);
                    }
                    else {
                        res.json({ message: 'This Username is already taken' });
                    }

                }
            }
            else {
                res.status(403).json({ message: 'You do not have access to add another user' })
            }
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