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
            // expect(models.has(Person)).toBe(true)

            const model = getModel(Person)
            expect((model as NodeEntitySchema).getLabels()).toEqual(['Person'])
        })

        // it('should register a model using a decorator which specified labels', () => {
        //     expect(models.has(Actor)).toBe(true)

        //     const model = models.get(Actor)
        //     expect(model.getLabels()).toEqual(['Actor', 'Person'])
        // })
    })

    describe('::save', () => {
        // it('should throw an error if model is not registered', () => {
        //     class UnknownModel {}

        //     neode.save(new UnknownModel)
        //         .then(() => fail())
        //         .catch(() => expect(true))
        // })


        // it('should save a model', async () => {
        //     const adam = Person.create(id, name)
        //     const saved = await neode.save<Person>(adam)

        //     expect(saved[ INTERNAL_NODE ]).toBeDefined()

        //     // expect(summary.counters.updates().propertiesSet).toEqual(1)
        // })
    })

    describe('::find', () => {
        it('should find a node and hydrate into an object', async () => {
            // const adam = await neode.find<Person>(Person, id)

            // expect(adam.getId()).toEqual(id)
            // expect(adam.getName()).toEqual(name)

            // console.log(adam);
            // console.log(adam['directed']);

        })
    })
})