const firebase = require('firebase/app');
// require('firebase/firestore'); //I dont think we'll need this atm

const firebaseConfig = {
    apiKey: "AIzaSyAriMlY99iSs-gG3hHYnU7Kb1ogj3i2THg",
    authDomain: "dojobackend-a8b59.firebaseapp.com",
    projectId: "dojobackend-a8b59",
    storageBucket: "dojobackend-a8b59.appspot.com",
    messagingSenderId: "297942814237",
    appId: "1:297942814237:web:1ca2dd612c29e23a3540f4",
    measurementId: "G-GG8PNZ82FS"
  };

firebase.initializeApp(firebaseConfig);

const mongoose = require('mongoose');
const express = require('express');
const app = express();
const cors = require('cors');
const bodyParser = require('body-parser');
const discordOauth2 = require('discord-oauth2');
const oauth = new discordOauth2();
const stripe = require('stripe')('sk_test_51Hzr5iDDUm17J8yEQMImwpS2DnG7V77sWoZzTeFM4iCEcTSQxwzMDzBIUk8ZFhKYJoww85AWxRS3BPWCKnW54DFB00OawqqLQ3');

app.use(cors());

mongoose.connect('mongodb+srv://quellen:'+process.env.mongopass+'@cluster0.jxtal.mongodb.net/dojodb?retryWrites=true&w=majority',{useNewUrlParser:true,useUnifiedTopology:true})
let port = process.env.PORT || 3000;

//Models
const BIPlayerSchema = new mongoose.Schema({
    discordUsername: String,
    steamID: String
});

const GiveawayEntrantSchema = new mongoose.Schema({
    discord: String
});

const VIPCustomerSchema = new mongoose.Schema({
    vipsteamID: String,
    purchasedate: Date
});

const BIPlayer = mongoose.model('BIPlayer',BIPlayerSchema);
const GiveawayEntrant = mongoose.model('GiveawayEntrant',GiveawayEntrantSchema);
const VIPCustomer = mongoose.model('VIPCustomer',VIPCustomerSchema);

// app.get('/test',(req,res) => {
//     const {user,id} = req.query;
//     const newPlayer = BIPlayer.create({discordUsername:user,steamID:id}).catch(e => {
//         res.status(500).send('Server Error');
//     });
//     res.send('Done!');
// });

app.get('/five',(req,res) => {
    res.status(500).end();
});

app.use('/buyvip',bodyParser.json());
app.post('/buyvip',async (req,res) => {
    let resp = {exists:false,sessionid:''}
    let steamid = req.body['steamid'];
    if (!steamid) { res.status(500).send(); return; }
    await VIPCustomer.findOne({vipsteamID:steamid},(e,d) => {
        if (d !== null) {
            resp.exists = true;
            res.json(resp).send();
        }
    });

    if (!resp.exists) {
        //Continue if doesn't already exist
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            mode: 'payment',
            cancel_url: 'https://epic-elion-b92a4f.netlify.app/store.html',
            success_url: 'https://epic-elion-b92a4f.netlify.app/sitemessage.html?size=3&color=ffffff&msg=Thank%20you%20for%20your%20purchase!',
            line_items: [
                {price:'price_1HzrNCDDUm17J8yEXQ1wyZEf',quantity:1}
            ],
            payment_intent_data: {
                metadata: {steamID:steamid}
            }
        })

        resp.sessionid = session.id;
        res.json(resp);
    }
});

app.use('/payments',bodyParser.json());
app.post('/payments',(req,res) => {
    let intent = ''
    try {
        intent = req.body.data.object;
        if (req.body.type == 'payment_intent.succeeded') {
            const steamid = intent.metadata.steamID;
            VIPCustomer.create({vipsteamID:steamid,purchasedate:Date.now()}).catch(err => {
                //BIG ERROR WITH CREATING ENTRY. Notify me somehow?
                console.log(`Error with creating VIPCustomer with ID:${steamid}`);
            });
        }
    } catch {
        console.log(`Bad request sent to payments?! From ${req.ip}`);
    }
    res.status(200).end();
});

app.get('/sign',(req,res) => {
    const code = req.query['code'];
    console.log(`Sending code ${code} to discord...`);
    //First discord request
    const data = {
        clientId: '753807367484735568',
        clientSecret: process.env.clientSecret,
        grantType: 'authorization_code',
        code: code,
        redirectUri: process.env.redirectUri || 'http://127.0.0.1:5500/signupnext.html',
        scope: 'connections identify'
    };

    let userName = '';
    let id = '';
    let jsonRes = {
        got_code: false,
        has_discord: false,
        has_steam: false,
        already_exists: false
    }

    oauth.tokenRequest(data).then(res1 => {
        jsonRes.got_code = true;
        oauth.getUser(res1.access_token).then(res2 => {
            userName = res2.username+'#'+res2.discriminator;
            jsonRes.has_discord = true;
            oauth.getUserConnections(res1.access_token).then(res3 => {
                for (const conn of res3) {
                    if (conn.type == 'steam') {
                        id = conn.id;
                        jsonRes.has_steam = true;
                        break;
                    }
                }

                //No Steam connection
                if (id === '') {
                    res.json(jsonRes);
                    return;
                }

                //Check for existing player and add:
                //d will have _doc which contains _id and the fields discordUsername and steamID
                BIPlayer.findOne({steamID:id},(err,d) => {
                    if (d !== null) {
                        jsonRes.already_exists = true;
                        res.json(jsonRes);
                    } else {
                        BIPlayer.create({discordUsername:userName,steamID:id}).then(() => {
                            res.json(jsonRes);
                        }).catch(e => {
                            console.log('Error on creating BIPlayer?');
                            res.status(500).send();
                        });
                    }
                    
                });
                
            }).catch(() => res.status(500).send())
        }).catch(() => res.status(500).send());
    }).catch(() => {
        console.log('Error from Discord...');
        res.status(500).send();
    });
});

app.listen(port,() => {
    console.log('App listening');
});