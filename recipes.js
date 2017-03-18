var request = require("request");
var sql = require("mssql");

console.log("pull recipes");

var dbConfig = {
    server: process.env.DB_HOST,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PSWRD
}

var current = 0;
var count = 3;
var recipes;
var parseRetry = 1;
var getRetry = 1;
var storeRetry = 1;
var maxRetries = 5;
var failedRecipes = [];

function tryParseItem(item) {
    var returnItem;
    try {
        returnItem = "'" + JSON.stringify(item) + "'";
    }
    catch(e) {
        returnItem = null;
    }

    return returnItem;
}

function getRecipes() {
    request("https://api.guildwars2.com/v2/recipes", function(error, response, body) {
        if (error) {
            console.log("error getting recipes:");
            console.log(error);
        }
        else {
            try {
                recipes = JSON.parse(body);
                
                console.log(current);
                count = body.length;
                console.log(body[89612]);
                nextRecipe();
            }
            catch(e) {
                console.log("error parcing recipes");
                console.log(e);
            }
        }
    });
}

function nextRecipe() {
    if (current < count) {
        request("https://api.guildwars2.com/v2/recipes/" + recipes[current], function(error, response, body) {
            if (error) {
                console.log("error saving recipe");
                if (getRetry <= maxRetries) {
                    console.log("get retry " + getRetry + " of " + maxRetries);
                    setTimeout(function() {
                        getRetry++;
                        nextRecipe();
                    }, 1000 * getRetry);
                }
                else {
                    console.log("failed to get recipe id: " + recipes[current] + " after " + maxRetries + " retries");
                    failedRecipes.push(recipes[current]);
                    current++;
                    getRetry = 1;
                    nextRecipe();
                }
            }
            else {
                try {
                    var recipe = JSON.parse(body);
                    storeRecipe(recipe);
                }
                catch(e) {
                    console.log("error parsing recipe: " + recipes[current]);
                    console.log(e);
                    if (parseRetry < maxRetries) {
                        console.log("parse retry " + parseRetry + " of " + maxRetries);
                        setTimeout(function(){
                            parseRetry++;
                            nextRecipe();
                        }, 1000 * parseRetry);
                    }
                    else {
                        console.log("failed parsing recipe " + recipes[current] + " after " + maxRetries + "retries");
                        failedRecipes.push(recipes[current]);
                        current++;
                        parseRetry = 1;
                        nextRecipe();
                    }
                }
            }
        })
    }
    else {
        console.log("Pull complete...");
        console.log("failed IDs:");
        console.log(failedRecipes);
    }
}

function storeRecipe(body) {
    console.log("store recipe " + current + " of " + count + " - ID: " + recipes[current]);
    var conn = new sql.Connection(dbConfig);
    var request = new sql.Request(conn);
    conn.connect(function(error){
        if (error){
            console.log("error while connecting (ID: " + recipes[current] + ")");
            console.log(error);
            if (storeRetry < maxRetries) {
                console.log("connection retry " + storeRetry + " of " + maxRetries + " - ID: " + recipes[current]);
                setTimeout(function(){
                    storeRetry++;
                    storeRecipe(body);
                }, 1000 * storeRetry);
            }
            else {
                console.log("failed to connect to database after " + storeRetry + "attempts");
                failedRecipes.push(recipes[current]);
                storeRetry = 1;
                current++;
                nextRecipe();
            }
        }
        else {
            var requestString = "uspCreateRecipe ";
            requestString += "@id=" + body.id + ", ";
            requestString += "@type='" + body.type + "', ";
            requestString += "@output_item_id=" + body.output_item_id + ", ";
            requestString += "@output_item_count=" + body.output_item_count + ", ";
            requestString += "@min_rating=" + body.min_rating + ", ";
            requestString += "@time_to_craft_ms=" + body.time_to_craft_ms + ", ";
            requestString += "@disciplines=" + tryParseItem(body.disciplines) + ", ";
            requestString += "@flags=" + tryParseItem(body.flags) + ", ";
            requestString += "@ingredients=" + tryParseItem(body.ingredients) + ", ";
            requestString += "@chat_link='" + body.chat_link + "'";

            request.query(requestString, function(err, set){
                if (err) {
                    console.log("failed to store recipe: " + recipes[current] + " to database:");
                    console.log(requestString);
                    console.log(err);
                }
                conn.close();
                current++;
                parseRetry = 1;
                getRetry = 1;
                storeRetry = 1;
                nextRecipe();
            })
        }
    })
}

getRecipes();