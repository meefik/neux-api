import cluster from 'node:cluster';
import mongoose from 'mongoose';
import logger from '../utils/logger.mjs';
import models from '../models/index.mjs';

export default async function (ctx) {
  const conn = mongoose.connection;

  // Show debug logs
  if (logger.level === 'debug') {
    mongoose.set('debug', function (collectionName, method, query, doc) {
      // LOG format: rooms.find({}) { sort: {}, fields: undefined }
      logger.log({
        level: 'debug',
        label: 'mongo',
        message: `${collectionName}.${method}(${
          query ? JSON.stringify(query) : ''
        }) ${doc ? JSON.stringify(doc) : ''}`
      });
    });
  }

  conn.on('connected', async function () {
    logger.log({ level: 'info', label: 'mongo', message: 'Database is connected' });
  });

  conn.on('disconnected', function () {
    logger.log({ level: 'info', label: 'mongo', message: 'Database has been disconnected' });
  });

  conn.on('error', function (err) {
    logger.log({ level: 'error', label: 'mongo', message: err });
  });

  await mongoose.connect(ctx.uri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    autoIndex: false
  });

  for (const name in models) {
    const params = models[name];
    const schema = new mongoose.Schema(params.schema);
    for (const name in params.virtuals) {
      const value = params.virtuals[name];
      if (value.get) {
        schema.virtual(name).get(value.get);
      }
      if (value.set) {
        schema.virtual(name).set(value.set);
      }
      if (!value.get || value.set) {
        schema.virtual(name, value);
      }
    }
    for (const name in params.methods) {
      const value = params.methods[name];
      schema.methods[name] = value;
    }
    for (const name in params.statics) {
      const value = params.statics[name];
      schema.statics[name] = value;
    }
    const { versionKey, discriminatorKey } = schema.options;
    schema.set('toJSON', {
      transform (doc, ret) {
        ret.id = ret._id;
        delete ret._id;
        delete ret[versionKey];
        delete ret[discriminatorKey];
        return ret;
      }
    });
    const model = mongoose.model(name, schema);
    for (const name in params.events) {
      const value = params.events[name];
      model.on(name, value);
    }
    if (cluster.worker.id === 1) {
      model.emit('load');
    }
  }

  if (cluster.worker.id === 1) {
    await mongoose.syncIndexes();
  }

  return () => conn.close();
};