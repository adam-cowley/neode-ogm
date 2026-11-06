/**
 * Watch or Not — a basic movie recommendation engine using neode-ogm.
 *
 * Ported from https://github.com/adam-cowley/neode-example/blob/master/server.js
 *
 * Differences from the original:
 *  - `require('neode')` → `require('../../dist')` (run inside the neode-ogm repo)
 *  - `neode.cypher()` → `neode.readCypher()` / `neode.writeCypher()`
 *  - `neode.hydrateFirst(res, 'g')` → `neode.hydrateFirst(constructor, res, 'g')`
 *  - `neode.all('Genre')` → `neode.all(neode.model('Genre'))`
 *  - Cypher uses `$param` syntax (Neo4j 4+) and `elementId()` instead of
 *    numeric `id()` — matching the OGM's elementId-first identity
 */
const express = require('express')
const session = require('express-session')
const path = require('path')
const { randomUUID } = require('crypto')

/**
 * Load neode-ogm with the variables stored in `.env` and tell it to
 * look for models in the ./models directory.
 */
const neode = require('../../dist').fromEnv().withDirectory(path.join(__dirname, 'models'))

/**
 * Create a new Express instance
 */
const app = express()

app.set('view engine', 'jade')
app.set('views', path.join(__dirname, '/views'))

app.use(function (req, res, next) {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Headers', 'X-Requested-With')
  next()
})

app.use(
  session({
    genid: () => randomUUID(),
    resave: false,
    saveUninitialized: true,
    secret: 'neoderocks',
  }),
)

app.use(express.static(path.join(__dirname, 'public')))

/**
 * Get a random movie to rate based on the name of the genre
 *
 * @param  {String} genre   Name of the genre to find a movie from
 * @param  {Array}  rated   elementIds of already recommended movies
 * @return {Promise}        Resolves to `{ genre, movie }` entity instances
 */
function getNextMovie(genre, rated) {
  const params = { genre, rated }

  const ignore = rated.length ? 'AND NOT elementId(m) IN $rated' : ''
  const cypher = `
        MATCH (g:Genre)<-[:IN_GENRE]-(m:Movie)
        WHERE g.name = $genre
        ${ignore}
        RETURN g, m
        ORDER BY RAND() LIMIT 1
    `

  return neode.readCypher(cypher, params).then((res) => {
    const Genre = neode.model('Genre')
    const Movie = neode.model('Movie')

    return {
      genre: neode.hydrateFirst(Genre, res, 'g'),
      movie: neode.hydrateFirst(Movie, res, 'm'),
    }
  })
}

/**
 * Home page: a list of genres
 */
app.get('/', (req, res) => {
  neode.all(neode.model('Genre')).then((genres) => {
    res.render('index', { title: 'Home', genres })
  })
})

/**
 * Initial recommendation screen with the first movie ready to rate
 */
app.get('/recommend/:genre', (req, res) => {
  getNextMovie(req.params.genre, [])
    .then(({ genre, movie }) => {
      if (!genre || !movie) {
        return res.redirect('/')
      }

      res.render('vote', {
        title: genre.name + ' Recommendations',
        genre,
        movie,
      })
    })
    .catch((e) => {
      res.status(500).send(e.message)
    })
})

/**
 * Return a new movie to rate in the supplied genre, ignoring the
 * movies that have already been rated
 */
app.get('/recommend/:genre/next', (req, res) => {
  const rated = req.query.rated ? req.query.rated.split(',') : []

  getNextMovie(req.params.genre, rated)
    .then(({ movie }) => movie.toJson())
    .then((json) => res.send(json))
    .catch((e) => {
      res.status(500).send(e.message)
    })
})

/**
 * Create a set of RATED relationships from the query string, then run
 * the collaborative-filtering query to recommend a film based on the
 * ratings of similar users.
 *
 * In reality, you'd be better off installing bodyparser and taking this
 * in as a post body.
 */
app.get('/recommend/:genre/results', (req, res) => {
  const query = `
        MATCH (g:Genre) WHERE g.name = $genre
        MERGE (u:User {user_id: $user_id})
        WITH g, u

        UNWIND keys($ratings) AS movie
        MATCH (m) WHERE elementId(m) = movie
        MERGE (u)-[r:RATED]->(m)
        SET r.rating = $ratings[movie]

        WITH DISTINCT g, u

        MATCH (u)-[r1:RATED]->()<-[r2:RATED]-(other)
        WITH g, u, other, count(*) as in_common
        ORDER BY in_common DESC LIMIT 10

        MATCH (other)-[:RATED]->(recommendation)-[:IN_GENRE]->(g)
        WHERE NOT (u)-[:RATED]->(recommendation)

        RETURN g, recommendation, count(*) as occurrences
        ORDER BY occurrences DESC LIMIT 1
    `

  const params = {
    genre: req.params.genre,
    user_id: req.sessionID,
    ratings: JSON.parse(req.query.ratings),
  }

  neode
    .readCypher(query, params)
    .then((results) => {
      const genre = neode.hydrateFirst(neode.model('Genre'), results, 'g')
      const movie = neode.hydrateFirst(neode.model('Movie'), results, 'recommendation')

      if (!movie) {
        return res.status(404).send('No recommendation found — rate more films!')
      }

      res.render('recommendation', {
        title: 'We recommend ' + movie.title,
        genre,
        movie,
      })
    })
    .catch((e) => {
      res.status(500).send(e.message)
    })
})

/**
 * For examples of how to use neode-ogm to quickly generate a REST API,
 * see the route examples in ./routes/api.js
 */
app.use(require('./routes/api')(neode))

/**
 * Listen for requests on port 3000
 */
app.listen(3000, function () {
  console.log('app listening on http://localhost:3000') // eslint-disable-line no-console
})
