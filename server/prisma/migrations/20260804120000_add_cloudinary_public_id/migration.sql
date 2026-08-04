-- Add cloudinary public id for secure remote asset deletion
ALTER TABLE "StorageAsset" ADD COLUMN "cloudinaryPublicId" TEXT;
