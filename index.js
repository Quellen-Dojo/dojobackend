// require('firebase/firestore'); //I dont think we'll need this atm
require('dotenv').config();
const mongoose = require('mongoose');
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const discordOauth2 = require('discord-oauth2');
const stripe = require('stripe')(process.env.stripeSK);
const https = require('https');

const app = express();
const oauth = new discordOauth2();

app.use(cors());

mongoose.connect('mongodb+srv://quellen:'+process.env.mongopass+'@cluster0.jxtal.mongodb.net/dojodb?retryWrites=true&w=majority',{useNewUrlParser:true,useUnifiedTopology:true});

//Schemas
const BIPlayerSchema = new mongoose.Schema({
    discordUsername: String,
    steamID: String
});

const GiveawayEntrantSchema = new mongoose.Schema({
    discordUsername: String
});

const VIPCustomerSchema = new mongoose.Schema({
    vipsteamID: String,
    purchasedate: Date,
    paymentIntent: String
});

//Models
const BIPlayer = mongoose.model('BIPlayer',BIPlayerSchema);
const GiveawayEntrant = mongoose.model('GiveawayEntrant',GiveawayEntrantSchema);
const VIPCustomer = mongoose.model('VIPCustomer',VIPCustomerSchema);

async function sendToDiscord(message) {
    const sendWebhook = https.request(process.env.discordWebhook,{
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    })

    sendWebhook.write(JSON.stringify({content:message,avatar_url:'https://sbp-plugin-images.s3.eu-west-1.amazonaws.com/technologies1905_5eb57bd25635d_icon.jpg'}));
    sendWebhook.end();
}

// app.get('/getsignups',async (req,res) => {
//     let theList = {};
//     await BIPlayer.find({}).then(fullList => {
//         res.json(fullList);
//     });
// });

app.get('/ping',(req,res) => {
    res.send('Pong!');
});

app.use('/buyvip',bodyParser.json());
app.post('/buyvip',async (req,res) => {
    let resp = {exists:false,sessionid:''};
    let steamid = req.body['steamid'];
    
    if (!steamid) {res.status(500).send(); return;}

    await VIPCustomer.findOne({vipsteamID:steamid},(error,data) => {
        if (data != null) {
            resp.exists = true;
            res.json(resp).send();
            return;
        }
    });

    if (!resp.exists) {
        //Continue if doesn't already exist
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            mode: 'payment',
            cancel_url: process.env.stripeCancel,
            success_url: process.env.stripeSuccess,
            line_items: [
                {price:process.env.stripeVIP,quantity:1}
            ],
            payment_intent_data: {
                metadata: {steamID:steamid,type:'vip'}
            }
        });

        resp.sessionid = session.id;
        res.json(resp);
    }
});

app.use('/buycoins',bodyParser.json());
app.post('/buycoins',async (req,res) => {
    let {steamid,quantity} = req.body;
    quantity = parseInt(quantity);
    if (!steamid || !quantity) {res.status(500).send(); return;}

    //Just in case some nucance posts me a non-int quantity

    const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'payment',
        cancel_url: process.env.stripeCancel,
        success_url: process.env.stripeSuccess,
        line_items: [
            {price:process.env.stripe1000,quantity:quantity}
        ],
        payment_intent_data: {
            metadata: {steamID:steamid,type:'coins',quant:quantity}
        }
    });

    res.json({sessionid:session.id});
});

app.use('/payments',bodyParser.json());
app.post('/payments',(req,res) => {
    let intent = ''
    try {
        intent = req.body.data.object;
        if (req.body.type == 'payment_intent.succeeded') {
            const steamid = intent.metadata.steamID;
            switch(intent.metadata.type) {
                case 'vip':
                    VIPCustomer.create({vipsteamID:steamid,purchasedate:Date.now(),paymentIntent:intent.id}).catch(err => {
                        //BIG ERROR WITH CREATING ENTRY. Notify me somehow?
                        console.log(`Error with creating VIPCustomer with ID:${steamid}`);
                    }).then((doc) => {
                        sendToDiscord(`VIP ${steamid}`);
                    });
                    break;
                case 'coins':
                    //MAKE Stuff to give coins on the dojo! NOW!!
                    sendToDiscord(`COINS ${steamid} ${intent.metadata.quant}`);
            }
        }
    } catch {
        console.log(`Bad request sent to payments?! From ${req.ip}`);
    }
    res.status(200).end();
});

app.use('/giveaway',bodyParser.json());
app.get('/giveaway', async (req,res) => {
    const code = req.query['code'];
    let jRes = {exists:false};
    const data = {
        clientId: '753807367484735568',
        clientSecret: process.env.clientSecret,
        grantType: 'authorization_code',
        code: code,
        redirectUri: process.env.redirectUri || 'http://127.0.0.1:5500/giveawaynext.html',
        scope: 'identify'
    };

    
    oauth.getUser((await oauth.tokenRequest(data)).access_token).then(user => {
        let username = user.username+'#'+user.discriminator;
        GiveawayEntrant.findOne({discordUsername:username},(err,dat) => {
            if (dat == null) {
                GiveawayEntrant.create({discordUsername:username}).then(() => {
                    res.json({exists:false}).send()
                });
            } else {
                res.json({exists:true}).send()
            }
        });
    });
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
                            res.json(jsonRes).send();
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

let port = process.env.PORT || 3000;

app.listen(port,() => {
    console.log(`App listening on ${port}`);
});