export const getAll = async <Entity>(
  getPageEntities: (
    nextMarker: undefined | string,
    page: number
  ) => Promise<{
    items: Entity[]
    nextMarker: undefined | string
  }>
) => {
  let nextMarker: string | undefined = undefined
  let page = 0
  const entities: Entity[] = []
  while (true) {
    page++
    const entitiesResponse: {
      items: Entity[]
      nextMarker: undefined | string
    } = await getPageEntities(nextMarker, page)

    entities.push(...entitiesResponse.items)

    if (entitiesResponse.nextMarker) {
      nextMarker = entitiesResponse.nextMarker
    } else {
      return entities
    }
  }
}
