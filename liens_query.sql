SELECT TOP (100)
      [accid_id]

      ,[ref_datetime]

      ,[Prac_Loc]
      ,[SF_Account_Name]

      ,[zip_code]

      ,[onset_date]

      ,[Lien Form Waived] AS Lien_Form_Waived
      ,[Lien Cap Amt]     AS Lien_Cap_Amt

      ,[accid_Bal]
  FROM [LIENS].[dbo].[Liens_Source]
