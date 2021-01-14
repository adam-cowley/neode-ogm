import { v4 } from 'uuid'
import { fromEnv } from "../../utils"
import Person from "../../../test/models/person"
import Movie from "../../../test/models/movie"
import Role from "../../../test/models/role"

describe('MergeService', () => {
    // @ts-ignore
    const neode = fromEnv()

    let ids = []

    // beforeAll(() => neode.writeCypher(`MATCH (n) DETACH DELETE n`))

    afterAll(async () => {
        await neode.writeCypher(`
            MATCH (n)
            WHERE id(n) IN $ids
            DETACH DELETE n
        `, { ids })
    })

    it('should merge a node and @OneToOne ', async () => {
        const id = v4()
        const name = 'Director'

        const directedMovieId = v4()
        const directedMovieTitle = 'Directed Movie'

        const actedInMovieId = v4()
        const actedInMovieTitle = 'Acted Movie'

        const otherMovieId = v4()
        const otherMovieTitle = 'Other Movie'

        const topRoleName = 'a'
        const otherRoleName = 'b'

        const p = Person.create(id, name)

        // @OneToOne NodeEntity: Directed Movie
        const directedMovie = new Movie

        directedMovie.setId(directedMovieId)
        directedMovie.setTitle(directedMovieTitle)

        p.setDirected(directedMovie)

        // @OneToMany NodeEntity: Acted In
        const actedInMovie = new Movie

        actedInMovie.setId(actedInMovieId)
        actedInMovie.setTitle(actedInMovieTitle)

        p.addActedIn(actedInMovie)

        // @OneToOne RelationshipEntity: Role
        const topRole = new Role()
        topRole.setMovie(directedMovie)
        topRole.addRole(topRoleName)

        p.setTopRole(topRole)


        // @OneToMany RelationshipEntity: Role
        const otherMovie = new Movie()
        otherMovie.setId(otherMovieId)
        otherMovie.setTitle(otherMovieTitle)

        const otherRole = new Role()
        otherRole.setMovie(otherMovie)
        otherRole.addRole(otherRoleName)

        p.addRole(otherRole)

        const res = await neode.save(p)

        expect(res.getId()).toEqual(id)

        // Assert
        expect(res.getId()).toEqual(id)
        expect(res.getName()).toEqual(name)

        // @OneToOne NodeEntity
        expect(res['directed']).toBeInstanceOf(Movie)
        expect(res['directed']['id']).toEqual(directedMovieId)
        expect(res['directed']['title']).toEqual(directedMovieTitle)

        // @OneToMany NodeEntity
        expect(res['actedIn']).toBeInstanceOf(Array)
        expect(res['actedIn'][0]).toBeInstanceOf(Movie)
        expect(res['actedIn'][0].id).toEqual(actedInMovieId)
        expect(res['actedIn'][0]['title']).toEqual(actedInMovieTitle)

        // @OneToOne RelationshipEntity
        expect(res['topRole']).toBeInstanceOf(Role)
        expect(res['topRole']['roles']).toEqual([ topRoleName ])
        expect(res['topRole']['movie']).toBeInstanceOf(Movie)
        expect(res['topRole']['movie']['id']).toEqual(directedMovieId)
        expect(res['topRole']['movie']['title']).toEqual(directedMovieTitle)

        // @OneToMany RelationshipEntity
        expect(res['roles']).toBeInstanceOf(Array)
        expect(res['roles'][0]).toBeInstanceOf(Role)
        expect(res['roles'][0]['roles']).toEqual([ otherRoleName ])
        expect(res['roles'][0]['movie']).toBeInstanceOf(Movie)
        expect(res['roles'][0]['movie']['id']).toEqual(otherMovieId)
        expect(res['roles'][0]['movie']['title']).toEqual(otherMovieTitle)

        // Clean up
        ids.push(
            res['_id'],
            res['directed']['_id'],
            res['actedIn'][0]['_id'],
            res['topRole']['_id'],
            res['roles'][0]['_id'],
        )
    })

})