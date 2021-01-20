import Person from "../../../test/models/person"
import { getModel, getModels } from "../../meta"
import { fromEnv } from "../../utils"
import FindByIdService from "./find-by-id.service"

describe('FindByIdService', () => {
    const neode = fromEnv()

    beforeEach(() => Person.create('Make sure it is defined in models'))

    it('should find a node by internal id ', async () => {
        const res = await neode.writeCypher('CREATE (p:Person) RETURN id(p) AS id')
        const id = res.records[0].get('id').toNumber()

        const tx = neode.readTransaction()
        const service = new FindByIdService(tx)

        const result = await service.find(Person, getModel(Person), id)

        await tx.rollback()

        expect(result).toBeDefined()
        expect(result).toBeInstanceOf(Person)
        expect(result['_id']).toEqual(id)
    })

    it('should find the node within the same transaction', async () => {
        await neode.inWriteTransaction(async tx => {
            const name = 'Within Transaction'
            const res = await tx.writeCypher(`
                CREATE (p:Person { id: randomUuid(), name: $name })
                RETURN p.id as idProperty, id(p) as internalId
            `, { name })

            const idProperty = res.records[0].get('idProperty')
            const internalId = res.records[0].get('internalId')

            const service = new FindByIdService(tx.getTransaction())

            const result = await service.find(Person, getModel(Person), internalId)

            expect(result).toBeInstanceOf(Person)
            expect(result.name).toEqual(name)
            expect(result._id).toEqual(internalId.toNumber())
            expect(result.id).toEqual(idProperty)
        })

    })
})