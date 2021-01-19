import { fromEnv } from "../../utils";
import Person from "../../../test/models/person"
import SchemaService from './schema.service'
import Neode from "../../neode.service";

describe('SchemaService', () => {

    let neode: Neode;
    let service: SchemaService

    beforeAll(() => {
        neode = fromEnv()

        // Ensure that the models are registered
        Person.create('id', 'name')

        service = new SchemaService(neode.getDriver(), true)
    })

    describe('::create', () => {
        it('should install the schema', async () => {
            const output = await service.create()

            expect(output.filter(res => res.success === false).length).toEqual(0)
        })

        it('should silently fail if the schema is already set', async () => {
            const output = await service.create()

            expect(output.filter(res => res.success === false).length).toEqual(6)
        })
    })

    describe('::drop', () => {
        it('should drop the schema', async () => {
            const output = await service.drop()

            expect(output.filter(res => res.success === false).length).toEqual(0)
        })

        it('should silently fail if the schema is not set', async () => {
            const output = await service.drop()

            expect(output.filter(res => res.success === false).length).toEqual(6)
        })
    })

})