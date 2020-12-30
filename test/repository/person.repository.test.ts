import { fromEnv } from "../../src";
import Person from "../models/person";
import PersonRepository from "./person.repository"

describe('Repository', () => {
    const neode = fromEnv()
    const repo = new PersonRepository(neode)

    describe('::merge', () => {
        it('should merge a node into the graph', async () => {
            const id = "00000000-0000-0000-0000-000000000000"
            const name = "Adam"

            const adam = Person.create(id, name)

            const result = await repo.merge(adam)

            await repo.delete(adam.getId())
        })
    })
})