import Person from './models/person'
import { models } from '../src/meta/index'
import { Neode } from '../src'

describe('e2e test example', () => {
    const neode = new Neode()

    const id = "92702e6b-4d39-4ad2-a4ad-cc3923496090"
    const name = "Adam"

    describe('Decorators', () => {
        it('should register a model using decorators', () => {
            expect(models.has(Person)).toBe(true)

            const model = models.get(Person)
            expect(model.getLabels()).toEqual(['Actor', 'Person'])

            // const adam = new Person("92702e6b-4d39-4ad2-a4ad-cc3923496090", "Adam")
            // console.log(model);
            // console.log(adam);
        })
    })

    describe('::save', () => {
        // it('should throw an error if model is not registered', () => {
            // class UnknownModel {}
        //     const t = () => neode.save(new UnknownModel)
        //     expect(t).toThrow()
        // })


        // it('should save a model', async () => {
        //     const adam = Person.create(id, name)
        //     const summary = await neode.save(adam)

        //     expect(summary.counters.updates().propertiesSet).toEqual(1)
        // })
    })

    describe('::find', () => {
        it('should find a node and hydrate into an object', async () => {
            const adam = await neode.find(Person, id)

            expect(adam.getId()).toEqual(id)
            expect(adam.getName()).toEqual(name)
        })


    })
})