# photo

* npm run dev  --> for automatic run your project

*npm i bootstrap      ---> this is for dependency

*npm i nodemon -D    ---> this is for dev dependency

*When you start a new project from scratch, you usually type this in your terminal to create a blank package.json:
npm init -y
----------------------------------------------------------
🔄 To Switch to S3 Later

Just change one line:
const USE_CLOUDINARY = false;

Or better — use an environment variable:
const USE_CLOUDINARY = process.env.STORAGE_PROVIDER !== 's3';

Then set:
STORAGE_PROVIDER=s3
----------------------------------------------------------
