-- Lead tags each company makes for itself (Wholesale, Retail...): the list, with colours, per lead business.
ALTER TABLE "LeadBusiness" ADD COLUMN "tagList" JSONB;
