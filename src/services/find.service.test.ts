import { v4 } from 'uuid'
import { fromEnv } from "../utils"
import Person from "../../test/models/person"
import Movie from "../../test/models/movie"
import Role from "../../test/models/role"

describe('FindService', () => {
    const neode = fromEnv()

    const id = v4()
    const name = 'Adam'

    const movieId = v4()
    const movieTitle = 'The Godfather'

    const roles = ['Adam Cowleone']

    beforeAll(async () => {
        await neode.writeCypher(`
            CREATE (p:Person {id: $id, name: $name})
            CREATE (m:Movie { id: $movieId, title: $movieTitle})

            CREATE (p)-[:ACTED_IN {roles: $roles}]->(m)
            CREATE (p)-[:DIRECTED]->(m)
        `, { id, name, movieId, movieTitle, roles })

        const person = Person.create(id, name)

        await neode.save(person)
    })

    it('should find a node and hydrate into an object with eager loading to one degree', async () => {
        const person = await neode.find<Person>(Person, id)

        expect(person.getId()).toEqual(id)
        expect(person.getName()).toEqual(name)

        expect(person['actedIn']).toBeInstanceOf(Array)
        expect(person['actedIn'][0]).toBeInstanceOf(Movie)
        expect(person['actedIn'][0].id).toEqual(movieId)

        expect(person['directed']).toBeInstanceOf(Movie)
        expect(person['directed']['id']).toEqual(movieId)
        expect(person['directed']['title']).toEqual(movieTitle)

        expect(person['topRole']).toBeInstanceOf(Role)
        expect(person['topRole']['movie']).toBeInstanceOf(Movie)
        expect(person['topRole']['movie']['id']).toEqual(movieId)

        expect(person['roles']).toBeInstanceOf(Array)
        expect(person['roles'][0]).toBeInstanceOf(Role)
        expect(person['roles'][0].internalId).toBeDefined()
        expect(person['roles'][0].roles).toEqual(roles)

        // console.log(JSON.stringify(person, null, 2))
    })
})