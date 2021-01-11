import Person from "../../test/models/person"
import { fromEnv } from "../utils"

describe('FindService', () => {
    const neode = fromEnv()

    const id = 'adam'
    const name = 'Adam'

    beforeAll(async () => {
        const adam = Person.create(id, name)

        await neode.save(adam)
    })

    it('should find a node and hydrate into an object', async () => {
        const adam = await neode.find<Person>(Person, id)

        console.log(adam);

        if ( adam ) {
            expect(adam?.getId()).toEqual(id)
            expect(adam?.getName()).toEqual(name)

            console.log(JSON.stringify(adam, null, 2))
        }
    })


    it('should ', () => {

    })

    it('should ', () => {

    })
})