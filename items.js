require("dotenv").config({ path: "./config.env" });
var request = require("request");
var sql = require("mssql");

var dbConfig = {
    server: process.env.DB_HOST,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PSWRD
};

// global variables
var itemIDs = [];
var failedItems = [];
var current = 0;
var count;
var parseRetry = 1;
var getRetry = 1;
var maxRetries = 5;

// util functions
function addItem(item) {
    var index = itemIDs.indexOf(item);
    if (index === -1) {
        itemIDs.push(item);
    }
}

function tryParseItem(item, replace) {
    var returnItem;
    try {
        var base = JSON.stringify(item);
        if (replace) {
            base = base.replace(/'/g, "&lsquo;");
        }
        returnItem = "'" + base + "'";
    }
    catch(e) {
        returnItem = null;
    }
    return returnItem;
}
// functions
function getItemIDs() {
    var conn = new sql.Connection(dbConfig);
    var request = new sql.Request(conn);
    conn.connect(function(err){
        if (err) {
            console.log("error connecting to database:");
            console.log(err);
            return;
        }

        request.query("select * from Recipes order by id", function(error, set){
            if (error) {
                console.log("error running query:");
                console.log(error);
                return;
            }
            console.log("set length: " + set.length);
            for (var i in set) {
                addItem(set[i].output_item_id);
                var ingredients = JSON.parse(set[i].ingredients);
                ingredients.forEach(function(item){
                    addItem(item.item_id);
                })
            }
            conn.close();
            count = itemIDs.length;
            current = 0;
            parseRetry = 1;
            getRetry = 1;
            nextItem();
        })
    })
}

function nextItem() {
    if (current < count) {
        request("https://api.guildwars2.com/v2/items/" + itemIDs[current], function(error, response, body){
            if (error) {
                console.log("error retreiving item: " + itemIDs[current]);
                if (getRetry <= maxRetries) {
                    console.log("get retry " + getRetry + " of " + maxRetries);
                    setTimeout(function(){
                        getRetry++;
                        nextItem();
                    }, 1000 * getRetry);
                }
                else {
                    console.log("failed to get item: " + itemIDs[current] + " after " + maxRetries + " retries");
                    failedItems.push(itemIDs[current]);
                    current++;
                    getRetry = 1;
                    nextItem();
                }
            }
            else {
                try {
                    var item = JSON.parse(body);

                    storeItem(item);
                }
                catch(e) {
                    console.log("error parsing item: " + itemIDs[current]);
                    console.log(e);
                    if (parseRetry <= maxRetries) {
                        console.log("parse retry " + parseRetry + " of " + maxRetries);
                        setTimeout(function(){
                            parseRetry++;
                            nextItem();
                        }, 1000 * parseRetry);
                    }
                    else {
                        console.log("failed parsing item " + itemIDs[current] + " after " + maxRetries + " retries");
                        failedItems.push(itemIDs[current]);
                        current++;
                        parseRetry = 1;
                        nextItem();
                    }
                }
            }
        });
    }
    else {
        console.log("pull complete...");
        console.log("failed item IDs: ");
        console.log(failedItems);
    }
}

function storeItem(body) {
    console.log("store item " + current + " of " + count + " - ID: " + itemIDs[current]);
    var conn = new sql.Connection(dbConfig);
    var request = new sql.Request(conn);
    conn.connect(function(error){
        if (error) {
            console.log("error while connecting to DB (ID: " + itemIDs[current] + ")");
            console.log(error);
            failedItems.push(itemIDs[current]);
            current++;
            nextItem();
        }
        else {
            var requestString = "uspCreateItem ";
            requestString += "@id=" + body.id + ", ";
            requestString += "@name='" + (body.name || "").replace(/'/g, "&lsquo;") + "', ";
            requestString += "@type='" + body.type + "', ";
            requestString += "@level=" + body.level + ", ";
            requestString += "@rarity='" + body.rarity + "', ";
            requestString += "@vendor_value=" + body.vendor_value + ", ";
            requestString += "@default_skin=" + (body.default_skin || 0) + ", ";
            requestString += "@game_types=" + tryParseItem(body.game_types) + ", ";
            requestString += "@flags=" + tryParseItem(body.flags) + ", ";
            requestString += "@restrictions=" + tryParseItem(body.restrictions) + ", ";
            requestString += "@chat_link='" + body.chat_link + "', ";
            requestString += "@icon='" + body.icon + "', ";
            requestString += "@details=" + tryParseItem(body.details, true)

            request.query(requestString, function(err, set){
                if (err) {
                    console.log("failed to store item: " + itemIDs[current] + " to database:");
                    console.log(requestString);
                    console.log(err);
                    failedItems.push(itemIDs[current]);
                }
                conn.close();
                current++;
                parseRetry = 1;
                getRetry = 1;
                nextItem();
            })
        }
    })
}

// start
getItemIDs();