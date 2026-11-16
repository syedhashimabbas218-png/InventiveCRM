// Universal identifiers. Generated once, then stable: never change or reuse one (see UPDATES.md rule 9).
export const IDS = {
  application: '992fae47-c2c3-4731-b8aa-ebdcdb466631',
  role: 'e95f32cc-3e1a-438a-8a38-1ebb96dde06e',
  campaign: {
    object: '3ffc98be-ef71-4758-bd1d-a35a02b50321',
    fields: {
      name: '5b913bd0-30f8-4606-aa37-6b6277fe1b20',
      channel: 'acffa79b-2fb8-4a2c-a7cd-add28b4566bf',
      status: '756988a3-9bf9-4fdd-9731-3b50ff67eb25',
      subject: '2cef2d4e-bda5-49fe-b95a-30707debc78a',
      previewText: '087280d2-4617-471d-b944-69227a9d130b',
      fromName: '74f85a0f-f721-4c80-ae0d-7cd6264011f3',
      fromLocalPart: '8b882a28-6985-4c66-b0dd-cfba8a562032',
      fromDomain: 'b37caedc-8fd2-42c2-8b0b-b2effb8c703a',
      replyTo: 'd8b9fd87-b529-4739-bf19-12e55b1391bf',
      listId: '8e098cb0-fada-4914-8521-251d2ca3d966',
      listName: '24abca23-ef14-46f9-9d46-bfef8a84d7a4',
      design: '816efd1c-cdaa-49e2-b27f-12ad9fe818af',
      scheduledAt: '27ec7b63-afac-4e03-8e96-c6e81addcf25',
      startedAt: '0db94d41-da38-44b5-8130-761ebabef0da',
      sentAt: '6e312446-3d26-4e7c-a626-cf339822b275',
      recipientCount: 'cb88886a-e3cc-4c1b-89d6-8ad8105a2157',
      sentCount: '80ebc545-09c9-4460-b23c-bf58c6856132',
      deliveredCount: 'c6a909e6-93fb-4497-a311-79b76427c99e',
      openedCount: 'd7d2fe05-94d4-4193-9c42-7f55fa330d4f',
      clickedCount: '085d647f-cbf1-4b2e-b03a-f984b67353e3',
      bouncedCount: '141b40db-7d39-4208-83ad-f213f0cef705',
      complainedCount: '770f56f9-f69e-4e34-844a-1b66cabd09d3',
      unsubscribedCount: '41780ffc-48ed-4ba8-a577-b030b286d71d',
      failedCount: '01e710b8-21cf-4b22-93cd-e4f4b6e76183',
      skippedCount: '2efc4443-20e0-4f71-b046-d1f7efd4aa5d',
      whatsappTemplate: '4d269fe6-08cb-412d-ab3f-5ab6c4a2b2cb',
      whatsappVariables: '3e3c1e9a-c8b0-41db-8715-86cd04c08df0',
      lastError: '8df2a135-38dd-4430-ad6f-3a60346f5c14',
      lockedUntil: '7c510207-5a4d-4789-b6de-f018b1610f99',
      prepareCursor: 'a4075ce5-d121-4bc7-b37a-d274a6190185',
      recipients: 'be86ad58-50bb-40e7-8e3d-37043cf0fdbf'
    }
  },
  recipient: {
    object: 'c0a41d58-5eff-45ed-b147-cd5d1595bc8d',
    fields: {
      name: '942a8aa0-f829-4805-9db5-87c827524e1e',
      campaign: '39ff5d1d-4486-44c5-bd0e-475d491721fc',
      person: '3e797792-17df-476d-8266-61cb491c04d2',
      address: '0f057b99-b2de-43a8-9975-282487ab9eff',
      status: '8d5652e3-7150-4d41-bc41-4fda7b49531a',
      providerMessageId: '43e5bcdb-156d-4343-bce1-ee4794cc39e8',
      error: '34f07b25-4793-47dc-b6d4-3cf39d5e58bd',
      sentAt: '8fbcd0e5-c20d-4170-b1f4-d1962cf62f2a',
      deliveredAt: '971488ac-7fbd-4b18-947d-958c86f91556',
      openedAt: '9b7aac1e-f4c9-456f-8c14-d508c6cd7ac8',
      clickedAt: 'e0a14974-de46-46e7-851f-620bff076a9f',
      bouncedAt: 'facbb519-89c0-4bdc-baec-d40c6d141f4f',
      complainedAt: '31008467-d29e-44eb-93d1-36cc9e387484',
      unsubscribedAt: 'aeca7489-b97d-4c70-a592-90686911fd75',
      batchKey: 'd8eb0a85-140d-4363-ac05-582faca96b94',
      nonce: 'fcff81b5-2ce4-46d4-b93b-4dddaf53e257'
    }
  },
  suppression: {
    object: 'dedecceb-1e94-4afe-a5c5-e0648a0b43ae',
    fields: {
      name: '3547a568-9160-4646-855b-c0dd76ef702a',
      address: 'b40719ef-c518-42b2-848f-7743809bb4cd',
      channel: 'eb6d2aa3-e270-49e8-b884-9c33e40f9ca3',
      reason: 'b71745c9-684f-4591-9b56-f936fde1d39b',
      campaignId: '5f19ebfa-8cb1-4847-a6ca-e6d4b33eb846',
      note: '3219b51b-fa20-4c1d-9a41-e2df3a652f01'
    }
  },
  template: {
    object: '1375836b-5d10-4486-9617-0a0e9276bd49',
    fields: {
      name: '780f462c-ea98-4162-b2bb-02b0b0487eec',
      category: 'aa09550d-7c02-438e-8677-01a8917f2cd9',
      description: '89108b2b-728a-470c-ad1e-6df8e9d42bc2',
      design: '341f5ba6-1f3c-4a90-964c-45c937c6bdc8'
    }
  },
  brand: {
    object: 'c7af8b02-81d7-4954-9a40-c6401fd583bb',
    fields: {
      name: '105910d9-7bdb-42c8-a442-1514315647dc',
      logoUrl: 'a72ff2db-f390-4b69-a4ed-2180ae1098ad',
      primaryColor: '85e81609-c919-424a-a274-81ab72cc5bf0',
      backgroundColor: '3b898929-84fc-495c-b804-6169e254b4ab',
      textColor: '9eef1347-e628-47ca-b32d-a7532dea1aab',
      fontFamily: '855144a7-3119-44e8-a7be-9c89ae1aec93',
      footerText: '114b17ce-7ab6-498c-922d-1e904c6b8f0b',
      websiteUrl: 'dee6d753-b33b-4888-b672-e31551bb8f59',
      trackingKey: 'bbc36e14-d0d4-4313-a215-77f0a9333086'
    }
  },
  list: {
    object: '2e89ad82-0dee-4a42-8a2b-042001a346bc',
    fields: { name: 'd01a648c-074b-421e-9460-c4a8d5f0f0a7', description: 'a2ff3fec-64cb-4af4-9d4d-175a468c86c5', memberCount: '8b61d688-2829-404c-a1a9-b8afe4f3d3a9', members: '27118044-f7fe-478c-8f9d-592758aa48c2' }
  },
  listMember: {
    object: '0fb0b8d6-4d21-4e10-aff8-53d64d9c3909',
    fields: { name: 'a1d3da47-c7f5-42b3-a608-844125d5debe', list: 'de297252-0cef-4fa4-9b31-313007b1493a', person: 'db7d1047-f9d0-4552-9771-b7ea682e4862' }
  },
  personExtension: {
    fields: {
      listMemberships: '0a49b597-2951-4474-835a-71cbf562430f',
      campaignRecipients: '19a308d3-1a02-4d2b-a52b-d9d57e8e8e01',
      emailMarketingConsent: 'a7f7efed-c372-4955-8845-c91a80685d95',
      whatsappMarketingConsent: 'c29e20a1-cde6-40f1-98e4-04c12a08c9e9'
    }
  },
  views: {
    campaigns: '6058d5ae-799a-4843-999e-59d8784cff0b',
    recipients: '4e6419ad-228b-4cad-a025-4aecc18452ef',
    suppressions: 'c8badbd7-975e-4e07-bc3b-e12ff6746bba',
    templates: '73a63083-c86a-4016-8e2b-b0af2d94a5c5',
    brand: '5943a2b7-d8ac-43ef-ae43-532216de1bcb',
    lists: 'f3898389-cccf-4af7-b0fe-23c64c469c96',
    listMembers: 'e31df4ca-a8b7-46a4-b6c5-bb6421bff44f',
    recipientsByCampaign: 'c6d50245-cbfa-465b-9f82-28a02fa90cea'
  },
  navigation: {
    folder: '1f743257-fabc-4f43-93fa-6fb88ee1fc96',
    studio: '98187ed5-fada-4ffc-b709-8d97c86ab63b',
    campaigns: 'c570925f-c567-491b-95e5-de972a1a066a',
    suppressions: '343c2024-454e-44c4-bb98-defce8dab099',
    templates: '6888b4ad-c2c8-4925-b992-eb9304681578',
    brand: 'c98f6bfa-5828-40af-b9f5-a177aac09d07',
    lists: '2113091b-fd66-4a0d-8969-ac2601247f5b'
  },
  pageLayouts: {
    studio: '5ae5d844-1087-4538-a6d8-235ea3d69f59'
  },
  pageLayoutTabs: {
    studio: '013c095d-1cc8-4375-bc65-618dfa6aa449'
  },
  pageLayoutWidgets: {
    studio: 'b0101962-d881-4491-ad5e-597174e16127'
  },
  frontComponents: {
    studio: 'a1370361-df5b-4567-8364-f4cdd0536fe0'
  },
  logicFunctions: {
    admin: 'fdaa5ce5-ea9d-4b99-a2bf-a4760caae889',
    job: '501ae4a1-f5c9-4a3e-afa5-645f75aec9a6',
    unsubscribePage: '7d5ee0a9-1f1d-4b99-a57c-35d7717658bf',
    unsubscribeApi: 'f8d8c8f6-6b7e-476e-924a-964515235200',
    webhook: 'e0264b6b-d6f8-4c3a-bf3e-c7030281f8c9',
    preview: 'cc4cd38d-3b65-409e-bb2b-017af10d6cde',
    connectAuthorize: '3d4a99fe-b3d5-4714-af97-b50a32803349',
    connectCallback: '717982d3-9e3a-48af-8b1f-04ee8a3819dc',
    connectPage: '31ce9d67-6279-43fd-8588-0f0cf5627176',
    connectStatus: '940fc861-63c5-46a5-9bf9-df9c25ff18e9',
    whatsappStatus: '210d1be3-d4f2-473d-90b6-00f51fede863'
  },
  connectionProviders: {
    resend: '3cd0f078-6423-42d2-9028-731766509b77'
  }
} as const;
