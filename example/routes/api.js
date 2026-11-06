/**
 * REST API examples — as this file needs an instance of neode-ogm, a function
 * is exported that returns a new express Router when called with the instance:
 *
 *   app.use(require('./routes/api')(neode));
 *
 * @param {Neode} neode  Neode instance
 * @return {Router}      Express router
 */
module.exports = function(neode) {
    const router = require('express').Router();

    const Movie = neode.model('Movie');

    /**
     * Use neode.all() to return a paginated list of movies
     */
    router.get('/api/movies', (req, res) => {
        const order_by = req.query.order || 'title';
        const sort = req.query.sort || 'ASC';
        const limit = parseInt(req.query.limit || 10, 10);
        const page = parseInt(req.query.page || 1, 10);
        const skip = (page - 1) * limit;

        const params = {};
        const order = { [order_by]: sort };

        neode.all(Movie, params, order, limit, skip)
            .then(movies => {
                // `all` returns the hydrated entities — toJson() serialises
                // them all (or collect them in a Collection first)
                return Promise.all(movies.map(movie => movie.toJson()));
            })
            .then(json => res.send(json))
            .catch(e => res.status(500).send(e.stack));
    });

    /**
     * Use `findById` to get a movie by its elementId.
     *
     * Note: this is the modern equivalent of neode's internal-id lookup —
     * elementIds are stable strings.
     */
    router.get('/api/movies/~:id', (req, res) => {
        neode.findById(Movie, req.params.id)
            .then(movie => movie.toJson())
            .then(json => res.send(json))
            .catch(e => res.status(500).send(e.stack));
    });

    /**
     * Use `find` to get a movie by its primary key. The primary key is
     * defined in the model definition by adding `primary: true`.
     */
    router.get('/api/movies/:id', (req, res) => {
        neode.find(Movie, req.params.id)
            .then(movie => movie.toJson())
            .then(json => res.send(json))
            .catch(e => res.status(500).send(e.stack));
    });

    /**
     * Run a more complex cypher query based on two parameter inputs:
     * find actors in common between two movies
     */
    router.get('/api/movies/:a_id/common/:b_id', (req, res) => {
        const params = { a_id: req.params.a_id, b_id: req.params.b_id };

        neode.readCypher('MATCH (a:Movie {id:$a_id})<-[:DIRECTED]-(actor)-[:DIRECTED]->(b:Movie {id: $b_id}) RETURN a, b, actor', params)
            .then(res => {
                const Actor = neode.model('Actor');

                return Promise.all([
                    // hydrateFirst returns the first row's record for the
                    // given alias, hydrated into an entity instance
                    neode.hydrateFirst(Movie, res, 'a').toJson(),
                    neode.hydrateFirst(Movie, res, 'b').toJson(),

                    // hydrate returns every row's record for the alias
                    Promise.all(neode.hydrate(Actor, res, 'actor').map(actor => actor.toJson())),
                ])
                    .then(([a, b, actors]) => ({ a, b, actors }));
            })
            .then(json => res.send(json))
            .catch(e => res.status(500).send(e.stack));
    });

    return router;
};
