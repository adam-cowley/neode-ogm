import EntitySchema, { EntityType } from '../meta/entity/entity-schema'
import { NodeEntity, Primary, RelationshipEntity, String, Uuid, StartNode, EndNode, OtherNode, OneToOne, OneToMany } from '.'
import { getModel } from '../meta'
import PropertySchema, { PropertyType } from '../meta/property-schema'
import { Direction } from '@neode/querybuilder'
import RelationshipPropertySchema from '../meta/relationship-property-schema'

describe('Decorators', () => {
    const labels = ['Something', 'Other']
    const type = 'KNOWS'

    @NodeEntity({ labels })
    class SomeNodeEntity {

        @Primary()
        id: string;

        @Uuid({
            unique: true
        })
        uuid: string;

        @String({ unique : true })
        unique: string;

        @String()
        string: string;

        @String({ array: true })
        stringArray: string;

        @OneToOne({
            type,
            // target: () => NodeEntity,
            direction: Direction.OUTGOING,
            eager: true,
        })
        oneToOne: EntitySchema;

        @OneToMany(
            // @ts-ignore
            () => NodeEntity,
            type,
            Direction.OUTGOING
        )
        oneToMany: EntitySchema[];

    }

    @RelationshipEntity()
    class SomeRelationshipEntity {

        @Uuid()
        uuid: string;

        // @ts-ignore
        @StartNode(() => SomeNodeEntity)
        startNode: SomeNodeEntity;

        // @ts-ignore
        @EndNode(() => SomeNodeEntity)
        endNode: SomeNodeEntity;

        // @ts-ignore
        @OtherNode(() => SomeNodeEntity)
        otherNode: SomeNodeEntity;

    }


    describe('@NodeEntity', () => {

        it('should have defined Something model', () => {
            const model = getModel(SomeNodeEntity)

            expect(model).toBeDefined()
            expect(model).toBeInstanceOf(EntitySchema)
            expect(model.getType()).toEqual(EntityType.NodeEntity)

            expect(model.getLabels()).toEqual(labels)
        })

        describe('@Primary', () => {
            it('should register primary key', () => {
                const property = getModel(SomeNodeEntity).getProperty('id')

                expect(property).toBeInstanceOf(PropertySchema)
                expect(property.getType()).toEqual(PropertyType.ANY)
                expect(property.isPrimaryKey()).toEqual(true)
                expect(property.isUnique()).toEqual(true)
                expect(property.getDefaultValue).toBeInstanceOf(Function)
            })
        })

        describe('@Uuid', () => {
            it('should register a UUID', () => {
                const property = getModel(SomeNodeEntity).getProperty('uuid')

                expect(property).toBeInstanceOf(PropertySchema)
                expect(property.getType()).toEqual(PropertyType.UUID)
                // expect(property.isPrimaryKey()).toEqual(true)
                expect(property.isUnique()).toEqual(true)
                expect(property.getDefaultValue).toBeInstanceOf(Function)
            })
        })

        describe('@Unique', () => {
            it('should register unique property', () => {
                const property = getModel(SomeNodeEntity).getProperty('unique')

                expect(property).toBeInstanceOf(PropertySchema)
                expect(property.getType()).toEqual(PropertyType.STRING)
                expect(property.isPrimaryKey()).toBeFalsy()
                expect(property.isUnique()).toEqual(true)
            })
        })

        describe('@String', () => {
            it('should register a string', () => {
                const property = getModel(SomeNodeEntity).getProperty('string')

                expect(property.getType()).toEqual(PropertyType.STRING)
                expect(property.isArray()).toBeFalsy()
            })

            it('should register an array of strings', () => {
                const property = getModel(SomeNodeEntity).getProperty('stringArray')

                expect(property.getType()).toEqual(PropertyType.STRING)
                expect(property.isArray()).toBeTruthy()
            })
        })

        describe('@OneToOne', () => {
            it('should register a one-to-one relationship', () => {
                const property = getModel(SomeNodeEntity).getRelationship('oneToOne')

                expect(property).toBeInstanceOf(RelationshipPropertySchema)
                expect(property.getType()).toEqual(type)
                expect(property.getEager()).toEqual(true)
                expect(property.getMany()).toEqual(false)
                expect(property.getDirection()).toEqual(Direction.OUTGOING)
            })
        })

        describe('@OneToMany', () => {
            it('should register a one-to-one relationship', () => {
                const property = getModel(SomeNodeEntity).getRelationship('oneToMany')

                expect(property).toBeInstanceOf(RelationshipPropertySchema)
                expect(property.getType()).toEqual(type)
                expect(property.getEager()).toBeFalsy()
                expect(property.getMany()).toEqual(true)
                expect(property.getDirection()).toEqual(Direction.OUTGOING)
            })
        })

    })

    describe('@RelationshipEntity', () => {
        it('should have defined Something model', () => {
            const model = getModel(SomeRelationshipEntity)

            expect(model).toBeDefined()
            expect(model).toBeInstanceOf(EntitySchema)
            expect(model.getType()).toEqual(EntityType.RelationshipEntity)
        })

        describe('@Uuid', () => {
            it('should register a UUID', () => {
                const property = getModel(SomeRelationshipEntity).getProperty('uuid')

                expect(property).toBeInstanceOf(PropertySchema)
                expect(property.getType()).toEqual(PropertyType.UUID)
                expect(property.getDefaultValue).toBeInstanceOf(Function)
            })
        })

        describe('@StartNode', () => {
            it('should register a Start Node', () => {
                const property = getModel(SomeRelationshipEntity).getProperty('startNode')

                expect(property).toBeInstanceOf(PropertySchema)
                expect(property.getType()).toEqual(PropertyType.START_NODE)
                expect(property.getEntity()).toEqual(SomeNodeEntity)
            })
        })

        describe('@EndNode', () => {
            it('should register a End Node', () => {
                const property = getModel(SomeRelationshipEntity).getProperty('endNode')

                expect(property).toBeInstanceOf(PropertySchema)
                expect(property.getType()).toEqual(PropertyType.END_NODE)
                expect(property.getEntity()).toEqual(SomeNodeEntity)
            })
        })

        describe('@OtherNode', () => {
            it('should register a End Node', () => {
                const property = getModel(SomeRelationshipEntity).getProperty('otherNode')

                expect(property).toBeInstanceOf(PropertySchema)
                expect(property.getType()).toEqual(PropertyType.OTHER_NODE)
                expect(property.getEntity()).toEqual(SomeNodeEntity)
            })
        })


    })

})