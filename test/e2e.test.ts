import { getModel } from '../src/meta/index'
import { fromEnv } from '../src'
import Person from './models/person'
// import Actor from './models/actor'

import NodeEntitySchema from '../src/meta/entity/entity-schema'

describe('e2e test example', () => {
    const neode = fromEnv()

    const id = "92702e6b-4d39-4ad2-a4ad-cc3923496090"
    const name = "Adam"

    describe('Decorators', () => {
        it('should register a model using decorators', () => {
            const model = getModel(Person)
            expect((model as NodeEntitySchema).getLabels()).toEqual(['Person'])
        })

        // it('should register a model using a decorator which specified labels', () => {
        //     expect(models.has(Actor)).toBe(true)

        //     const model = models.get(Actor)
        //     expect(model.getLabels()).toEqual(['Actor', 'Person'])
        // })
    })

    describe('::installSchema', () => {
        it('should create the schema', async () => {
            await neode.installSchema()
        })

        it('should not throw any errors if constraints already exist', async () => {
            await neode.installSchema()
        })
    })

    describe('::save', () => {
        it('should throw an error if model is not registered', () => {
            class UnknownModel {}

            neode.save(new UnknownModel)
                .then(() => fail())
                .catch(() => expect(true))
        })

        it('should save a model', async () => {
            const adam = Person.create(id, name)
            const saved = await neode.save<Person>(adam)

            expect(saved['_id']).toBeDefined()
        })

        // it('should throw an error when unique constraint is violated', async () =>
        //     try {
        //         const adam = Person.create('another-id', name)
        //         await neode.save<Person>(adam)

        //         fail()
        //     }
        //     catch(e) {
        //         expect(true)
        //     }
        // })
    })

    describe('::find', () => {
        it('should find a node and hydrate into an object', async () => {

        })
    })

    describe('::dropSchema', () => {
        it('should drop the schema', async () => {
            await neode.dropSchema()
        })

        it('should not throw any errors if constraints do not exist', async () => {
            await neode.dropSchema()
        })
    })
})