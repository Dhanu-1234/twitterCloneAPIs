const express = require("express");
const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());

const dbPath = path.join(__dirname, "twitterClone.db");
let db = null;

const initializer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server is running at http://localhost:3000");
    });
  } catch (e) {
    console.log(`DB Error: ${e.message}`);
    process.exit(1);
  }
};

initializer();

const authenticateUser = async (request, response, next) => {
  let jwtToken;
  const authHeaders = request.headers["authorization"];
  if (authHeaders !== undefined) {
    jwtToken = authHeaders.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(400);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "SECRET_KEY", async (error, payload) => {
      if (error) {
        response.status(400);
        response.send("Invalid JWT Token");
      } else {
        request.payload = payload;
        next();
      }
    });
  }
};

//API 1 register

app.post("/register", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const encryptedPassword = await bcrypt.hash(password, 10);
  const registerUserQuery = `
    INSERT INTO
        user(username,password,name,gender)
    VALUES
        (
            '${username}',
            '${encryptedPassword}',
            '${name}',
            '${gender}'
        );`;
  const getUserQuery = `
    SELECT
        *
    FROM
        user
    WHERE
        username='${username}';`;
  const dbUser = await db.get(getUserQuery);
  if (dbUser !== undefined) {
    response.status(400);
    response.send("User already exists");
  } else {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      await db.run(registerUserQuery);
      response.status(200);
      response.send("User created successfully");
    }
  }
});

//API 2 /login
app.post("/login", async (request, response) => {
  const { username, password } = request.body;
  const getUserQuery = `
    SELECT
        *
    FROM
        user
    WHERE
        username='${username}';`;
  const dbUser = await db.get(getUserQuery);
  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const comparePassword = await bcrypt.compare(password, dbUser.password);
    if (comparePassword) {
      const payload = { username: username };
      const jwtToken = jwt.sign(payload, "SECRET_KEY");
      response.status(200);
      response.send({ jwtToken: jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

//API 3 Returns the latest tweets of people whom the user follows. Return 4 tweets at a time
app.get("/user/tweets/feed", authenticateUser, async (request, response) => {
  const { username } = request.payload;
  const getUserQuery = `
  SELECT
    *
  FROM
    user
  WHERE
    username='${username}';`;
  const dbUser = await db.get(getUserQuery);
  const getTweetsQuery = `
  SELECT
    user.username AS username,
    tweet.tweet AS tweet,
    tweet.date_time AS dateTime
  FROM
    user INNER JOIN tweet ON user.user_id = tweet.user_id
  WHERE
    tweet.user_id IN (
        SELECT
            following_user_id
        FROM
            follower
        WHERE
            follower_user_id = '${dbUser.user_id}'
    )
  LIMIT 4;`;
  const dbResponseArray = await db.all(getTweetsQuery);
  response.send(dbResponseArray);
});

//API 4 Returns the list of all names of people whom the user follows
app.get("/user/following", authenticateUser, async (request, response) => {
  const { username } = request.payload;
  const getUserQuery = `
    SELECT
        *
    FROM
        user
    WHERE
        username='${username}';`;
  const dbUser = await db.get(getUserQuery);
  const getUserFollowsUsersQuery = `
    SELECT
        name
    FROM
        user INNER JOIN follower ON user.user_id = follower.following_user_id
    WHERE
        follower_user_id='${dbUser.user_id}';`;
  const dbResponseArray = await db.all(getUserFollowsUsersQuery);
  response.send(dbResponseArray);
});

//API 5 Returns the list of all names of people who follows the user
app.get("/user/followers", authenticateUser, async (request, response) => {
  const { username } = request.payload;
  const getUserQuery = `
    SELECT
        *
    FROM
        user
    WHERE
        username='${username}';`;
  const dbUser = await db.get(getUserQuery);
  const getUserFollowersQuery = `
    SELECT
        name
    FROM
        user INNER JOIN follower ON user.user_id = follower.follower_user_id
    WHERE
        following_user_id='${dbUser.user_id}';`;
  const dbResponseArray = await db.all(getUserFollowersQuery);
  response.send(dbResponseArray);
});

//API 6 If the user requests a tweet of the user he is following, return the tweet, likes count, replies count and date-time
app.get("/tweets/:tweetId", authenticateUser, async (request, response) => {
  const { tweetId } = request.params;
  const { username } = request.payload;
  const getUserQuery = `
    SELECT
        *
    FROM
        user
    WHERE
        username='${username}';`;
  const dbUser = await db.get(getUserQuery);
  const getTweetedUserQuery = `
  SELECT
    user.user_id AS user_id
  FROM
    tweet INNER JOIN user ON tweet.user_id = user.user_id
  WHERE
    tweet.tweet_id = '${tweetId}';`;
  const tweetedUser = await db.get(getTweetedUserQuery);
  const getUserFollowsQuery = `
    SELECT
        following_user_id
    FROM
        follower
    WHERE
        follower_user_id = '${dbUser.user_id}'`;
  const userFollows = await db.all(getUserFollowsQuery);
  const isUserFollowingTweetedUser = userFollows.some(
    (eachObj) => tweetedUser.user_id === eachObj.following_user_id
  );
  const getTweetDetailsQuery = `
    SELECT
        tweet.tweet AS tweet,
        COUNT(like.user_id) AS likes,
        COUNT(reply.reply_id) AS replies,
        tweet.date_time AS dateTime
    FROM
        (tweet INNER JOIN like ON tweet.tweet_id = like.tweet_id) INNER JOIN
        reply ON tweet.tweet_id = reply.tweet_id
    WHERE
        tweet.tweet_id = '${tweetId}'`;
  const dbResponseObj = await db.get(getTweetDetailsQuery);
  if (isUserFollowingTweetedUser) {
    response.send(dbResponseObj);
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
});

//API 7 If the user requests a tweet of a user he is following, return the list of usernames who liked the tweet
app.get(
  "/tweets/:tweetId/likes",
  authenticateUser,
  async (request, response) => {
    const { tweetId } = request.params;
    const { username } = request.payload;
    const getUserQuery = `
    SELECT
        *
    FROM
        user
    WHERE
        username='${username}';`;
    const dbUser = await db.get(getUserQuery);
    const getTweetedUserQuery = `
  SELECT
    user.user_id AS user_id
  FROM
    tweet INNER JOIN user ON tweet.user_id = user.user_id
  WHERE
    tweet.tweet_id = '${tweetId}';`;
    const tweetedUser = await db.get(getTweetedUserQuery);
    const getUserFollowsQuery = `
    SELECT
        following_user_id
    FROM
        follower
    WHERE
        follower_user_id = '${dbUser.user_id}'`;
    const userFollows = await db.all(getUserFollowsQuery);
    const isUserFollowingTweetedUser = userFollows.some(
      (eachObj) => tweetedUser.user_id === eachObj.following_user_id
    );
    const getTweetLikedUsersQuery = `
    SELECT
        user.name AS name
    FROM
        like INNER JOIN user ON like.user_id = user.user_id
    WHERE
        like.tweet_id = '${tweetId}';`;
    const likedUsers = await db.all(getTweetLikedUsersQuery);
    const likedUsersArray = likedUsers.map((eachUser) => eachUser.name);
    if (isUserFollowingTweetedUser) {
      response.send({ likes: likedUsersArray });
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

//API 8 If the user requests a tweet of a user he is following, return the list of replies.
app.get(
  "/tweets/:tweetId/replies",
  authenticateUser,
  async (request, response) => {
    const { tweetId } = request.params;
    const { username } = request.payload;
    const getUserQuery = `
    SELECT
        *
    FROM
        user
    WHERE
        username='${username}';`;
    const dbUser = await db.get(getUserQuery);
    const getTweetedUserQuery = `
  SELECT
    user.user_id AS user_id
  FROM
    tweet INNER JOIN user ON tweet.user_id = user.user_id
  WHERE
    tweet.tweet_id = '${tweetId}';`;
    const tweetedUser = await db.get(getTweetedUserQuery);
    const getUserFollowsQuery = `
    SELECT
        following_user_id
    FROM
        follower
    WHERE
        follower_user_id = '${dbUser.user_id}'`;
    const userFollows = await db.all(getUserFollowsQuery);
    const isUserFollowingTweetedUser = userFollows.some(
      (eachObj) => tweetedUser.user_id === eachObj.following_user_id
    );
    const getRepliesUsersQuery = `
    SELECT
        user.name AS name,
        reply.reply AS reply
    FROM
        user INNER JOIN reply ON user.user_id = reply.user_id
    WHERE
        reply.tweet_id = '${tweetId}';`;
    const repliedUsersArray = await db.all(getRepliesUsersQuery);
    if (isUserFollowingTweetedUser) {
      response.send({ replies: repliedUsersArray });
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

//API 9 Returns a list of all tweets of the user
app.get("/user/tweets", authenticateUser, async (request, response) => {
  const { username } = request.payload;
  const getUserQuery = `
    SELECT
        *
    FROM
        user
    WHERE
        username='${username}';`;
  const dbUser = await db.get(getUserQuery);
  const getTweetsQuery = `
    SELECT
        tweet.tweet,
        COUNT(like.like_id) AS likes,
        COUNT(reply.reply_id) AS replies,
        tweet.date_time AS dateTime
    FROM
        (tweet INNER JOIN like ON tweet.tweet_id = like.tweet_id) INNER JOIN
        reply ON tweet.tweet_id = reply.tweet_id
    WHERE
        tweet.user_id = '${dbUser.user_id}';`;
  const tweets = await db.all(getTweetsQuery);
  response.send(tweets);
});

//API 10 Create a tweet in the tweet table
app.post("/user/tweets", authenticateUser, async (request, response) => {
  const { username } = request.payload;
  const { tweet } = request.body;
  const getUserQuery = `
  SELECT
    *
  FROM
    user
  WHERE
    username='${username}';`;
  const dbUser = await db.get(getUserQuery);
  const date = new Date();
  const today = `${date.getFullYear()}-${
    date.getMonth() + 1
  }-${date.getDate()} ${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}`;
  const postTweetQuery = `
  INSERT INTO
    tweet(tweet,user_id,date_time)
  VALUES
    (
        '${tweet}',
        ${dbUser.user_id},
        '${today}'
    );`;
  await db.run(postTweetQuery);
  response.send("Created a Tweet");
});

//API 11 Delete a tweet
app.delete("/tweets/:tweetId", authenticateUser, async (request, response) => {
  const { username } = request.payload;
  const { tweetId } = request.params;
  const getUserQuery = `
    SELECT
        *
    FROM
        user
    WHERE
        username='${username}';`;
  const dbUser = await db.get(getUserQuery);
  const getTweetQuery = `
    SELECT
        *
    FROM
        tweet
    WHERE
        tweet_id = ${tweetId} AND
        user_id = ${dbUser.user_id};`;
  const tweet = await db.get(getTweetQuery);
  const deleteTweetQuery = `
  DELETE FROM tweet
  WHERE tweet_id = ${tweetId};`;
  if (tweet === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    await db.run(deleteTweetQuery);
    response.send("Tweet Removed");
  }
});

module.exports = app;
