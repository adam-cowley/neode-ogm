import { fromEnv } from "../../utils";
import Person from "../../../test/models/person"
import SchemaService from './schema.service'
import Neode from "../../neode.service";

describe('SchemaService', () => {

    let neode: Neode;

    beforeAll(() => {
        neode = fromEnv()

        // Ensure that the models are registered
        Person.create('id', 'name')
    })

    describe('::create', () => {

        it('should install the schema', async () => {
            const service = new SchemaService(neode.getDriver())

            await service.create()
        })

        it('should silently fail if the schema is already set', () => {

        })
    })

    describe('::drop', () => {
        it('should drop the schema', async () => {
            const service = new SchemaService(neode.getDriver())

            await service.drop()
        })

        it('should silently fail if the schema is already set', () => {

        })
    })

})