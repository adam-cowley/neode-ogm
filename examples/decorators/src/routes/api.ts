/**
 * REST API examples — as this file needs an instance of neode-ogm, a function
 * is exported that returns a new express Router when called with the instance.
 * Decorator form of `examples/models/routes/api.js`.
 *
 * @param neode  Neode instance
 */
import { Router } from 'express'
import { hydrate, hydrateFirst } from '../../../../dist'
import type Neode from '../../../../dist'
import type { WithMethods } from '../../../../dist'
import { Actor, Movie } from '../models'

export = function (neode: Neode) {
  const router = Router()

  /**
   * Paginated movie list — `neode.paginate()` runs the data query and the
   * COUNT query, returning { items, total, page, limit, totalPages }
   */
  router.get('/api/movies', (req, res) => {
    const page = parseInt(String(req.query.page || 1), 10)
    const limit = parseInt(String(req.query.limit || 10), 10)
    const order = String(req.query.order || 'title')
    const sort = String(req.query.sort || 'ASC') === 'DESC' ? 'DESC' : 'ASC'

    neode
      .paginate(Movie, {}, { page, limit, order: { [order]: sort } })
      .then((result) => {
        res.send({
          total: result.total,
          page: result.page,
          totalPages: result.totalPages,
          items: result.items.map((movie) => (movie as WithMethods<Movie>).toJson()),
        })
      })
      .catch((e) => res.status(500).send((e as Error).stack))
  })

  /**
   * Use `findById` to get a movie by its elementId.
   */
  router.get('/api/movies/~:id', (req, res) => {
    neode
      .findById(Movie, req.params.id)
      .then((movie) => (movie as WithMethods<Movie>).toJson())
      .then((json) => res.send(json))
      .catch((e) => res.status(500).send((e as Error).stack))
  })

  /**
   * Use `find` to get a movie by its primary key. The primary key is
   * declared with `@Property({ type: 'string', primary: true })`.
   */
  router.get('/api/movies/:id', (req, res) => {
    neode
      .find(Movie, req.params.id)
      .then((movie) => (movie as WithMethods<Movie>).toJson())
      .then((json) => res.send(json))
      .catch((e) => res.status(500).send((e as Error).stack))
  })

  /**
   * Run a more complex cypher query based on two parameter inputs:
   * find actors in common between two movies
   */
  router.get('/api/movies/:a_id/common/:b_id', (req, res) => {
    const params = { a_id: req.params.a_id, b_id: req.params.b_id }

    neode
      .readCypher(
        'MATCH (a:Movie {id:$a_id})<-[:DIRECTED]-(actor)-[:DIRECTED]->(b:Movie {id: $b_id}) RETURN a, b, actor',
        params,
      )
      .then((res) => {
        return Promise.all([
          // hydrateFirst returns the first row's record for the
          // given alias, hydrated into an entity instance
          hydrateFirst(Movie, res, 'a')!.toJson(),
          hydrateFirst(Movie, res, 'b')!.toJson(),

          // hydrate returns every row's record for the alias
          Promise.all(hydrate(Actor, res, 'actor').map((actor) => actor.toJson())),
        ]).then(([a, b, actors]) => ({ a, b, actors }))
      })
      .then((json) => res.send(json))
      .catch((e) => res.status(500).send((e as Error).stack))
  })

  return router
}
