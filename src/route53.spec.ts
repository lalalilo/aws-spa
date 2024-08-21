import { route53 } from './aws-services'
import { createHostedZone, findHostedZone, updateRecord } from './route53'
import { awsResolve } from './test-helper'

jest.mock('inquirer', () => {
  return {
    __esModule: true,
    default: { prompt: jest.fn() },
  }
})

describe('route53', () => {
  describe('findHostedZone', () => {
    const listHostedZonesMock = jest.spyOn(route53, 'listHostedZones')

    afterEach(() => {
      listHostedZonesMock.mockReset()
    })

    it('should search among all hosted zones', async () => {
      const matchingHostedZone = { Name: 'example2.com' }
      listHostedZonesMock
        .mockReturnValueOnce(
          awsResolve({
            HostedZones: [{ Name: 'example1.com' }],
            NextMarker: 'xxx',
          })
        )
        .mockReturnValueOnce(awsResolve({ HostedZones: [matchingHostedZone] }))

      expect(await findHostedZone('hello.example2.com')).toBe(
        matchingHostedZone
      )
    })

    it('should should match if hosted zone have a trailing dot', async () => {
      const matchingHostedZone = { Name: 'example.com.' }
      listHostedZonesMock.mockReturnValue(
        awsResolve({
          HostedZones: [matchingHostedZone],
        })
      )

      expect(await findHostedZone('hello.example.com')).toBe(matchingHostedZone)
    })

    it('should return null if there is no hosted found', async () => {
      listHostedZonesMock.mockReturnValue(
        awsResolve({
          HostedZones: [{ Name: 'example2.com.' }],
        })
      )

      expect(await findHostedZone('hello.example.com')).toEqual(null)
    })
  })

  describe('createHostedZone', () => {
    const createHostedZoneMock = jest.spyOn(route53, 'createHostedZone')

    afterEach(() => {
      createHostedZoneMock.mockReset()
    })

    it('should create a hosted zone', async () => {
      createHostedZoneMock.mockReturnValue(awsResolve({ HostedZone: {} }))

      await createHostedZone('hello.example.com')
      expect(createHostedZoneMock).toHaveBeenCalledTimes(1)
      const hostedZoneParams: any = createHostedZoneMock.mock.calls[0][0]
      expect(hostedZoneParams.Name).toEqual('hello.example.com')
    })
  })

  describe('updateRecord', () => {
    const changeResourceRecordSetsMock = jest.spyOn(
      route53,
      'changeResourceRecordSets'
    )

    afterEach(() => {
      changeResourceRecordSetsMock.mockReset()
    })

    it('should create a hosted zone', async () => {
      changeResourceRecordSetsMock.mockReturnValue(awsResolve())

      await updateRecord(
        'zone-id',
        'hello.example.com',
        'distribution-id.cloudfront.net'
      )
      expect(changeResourceRecordSetsMock).toHaveBeenCalledTimes(1)
      const updateRecordParams: any =
        changeResourceRecordSetsMock.mock.calls[0][0]
      expect(updateRecordParams.HostedZoneId).toEqual('zone-id')
      expect(
        updateRecordParams.ChangeBatch.Changes[0].ResourceRecordSet.Name
      ).toEqual('hello.example.com.')
      expect(
        updateRecordParams.ChangeBatch.Changes[0].ResourceRecordSet.AliasTarget
          .DNSName
      ).toEqual('distribution-id.cloudfront.net.')
    })
  })
})
