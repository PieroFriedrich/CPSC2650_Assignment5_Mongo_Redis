const express = require("express");
const { MongoClient, ObjectId } = require("mongodb");
const redis = require("redis");
require("dotenv").config();
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());

const uri = process.env.MONGOURI;
const dbName = process.env.MONGODBNAME;
const client = new MongoClient(uri);
let db;

const redisClient = redis.createClient();

(async () => {
  try {
    await redisClient.connect();
    await client.connect();
    db = client.db(dbName);
    console.log("Connected to MongoDB and Redis");
  } catch (error) {
    console.error("Error connecting to MongoDB or Redis:", error);
  }
})();

redisClient.on("error", (error) => console.error(`Error : ${error}`));

const cacheDuration = 3600;

app.get("/", (req, res) => {
  res.send("Movie API!");
});

app.get("/movies", async (req, res) => {
  const cacheKey = "movies";
  const cachedMovies = await redisClient.get(cacheKey);

  if (cachedMovies) {
    return res.json(JSON.parse(cachedMovies));
  }

  const movies = await db.collection("movies").find().limit(10).toArray();
  const response = movies.map((movie) => ({
    id: movie._id,
    name: movie.name,
    title: movie.title,
  }));

  await redisClient.setEx(cacheKey, cacheDuration, JSON.stringify(response));

  res.json(response);
});

app.get("/movie/:id", async (req, res) => {
  const movieId = req.params.id;
  const cacheKey = `movie:${movieId}`;
  const cachedMovie = await redisClient.get(cacheKey);

  if (cachedMovie) {
    return res.json(JSON.parse(cachedMovie));
  }

  try {
    const movie = await db
      .collection("movies")
      .findOne({ _id: new ObjectId(movieId) });
    if (movie) {
      const response = { id: movie._id, name: movie.name, title: movie.title };
      await redisClient.setEx(
        cacheKey,
        cacheDuration,
        JSON.stringify(response)
      );
      return res.json(response);
    } else {
      res.status(404).send("Movie not found");
    }
  } catch (error) {
    console.error("Error fetching movie:", error);
    res.status(500).send("Error fetching movie");
  }
});

app.patch("/movie/:id", async (req, res) => {
  const movieId = req.params.id;
  const { title } = req.body;

  try {
    const result = await db
      .collection("movies")
      .updateOne({ _id: new ObjectId(movieId) }, { $set: { title: title } });

    if (result.matchedCount > 0) {
      const cacheKey = `movie:${movieId}`;
      await redisClient.del(cacheKey);

      const updatedMovie = await db
        .collection("movies")
        .findOne({ _id: new ObjectId(movieId) });
      const response = {
        id: updatedMovie._id,
        name: updatedMovie.name,
        title: updatedMovie.title,
      };
      await redisClient.setEx(
        cacheKey,
        cacheDuration,
        JSON.stringify(response)
      );

      return res.json(response);
    } else {
      console.log(`Movie with ID ${movieId} not found.`);
      res.status(404).send("Movie not found");
    }
  } catch (error) {
    console.error("Error updating movie:", error);
    res.status(500).send("Error updating movie");
  }
});

app.delete("/movie/:id", async (req, res) => {
  const movieId = req.params.id;
  const result = await db
    .collection("movies")
    .deleteOne({ _id: new ObjectId(movieId) });

  if (result.deletedCount > 0) {
    const cacheKey = `movie:${movieId}`;
    await redisClient.del(cacheKey);
    res.send("Movie deleted");
  } else {
    res.status(404).send("Movie not found");
  }
});

app.get("/mongo", async (req, res) => {
  const start = new Date().getTime();

  try {
    const movies = await db.collection("movies").find().limit(10).toArray();
    const responseTime = new Date().getTime() - start;
    res.send(`MongoDB Response Time: ${responseTime}ms`);
  } catch (error) {
    console.error("Error fetching MongoDB data:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get("/redis", async (req, res) => {
  const start = new Date().getTime();

  try {
    const movies = await redisClient.get("movies");

    const responseTime = new Date().getTime() - start;

    if (movies) {
      res.send(`Redis Response Time: ${responseTime}ms`);
    } else {
      res.status(404).send("No data found in Redis");
    }
  } catch (error) {
    console.error("Error fetching Redis data:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
