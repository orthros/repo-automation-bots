/**
 * Copyright 2019 Google LLC. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Application } from 'probot';
import { request } from 'gaxios';
import { GCFBootstrapper } from 'gcf-utils';
import { GitHubAPI } from 'probot/lib/github';
import {labels} from './labels.json';

const reposUrl = 'https://github.com/googleapis/sloth/blob/master/repos.json';

interface RepoResponse {
  repos: {
    language: string;
    repo: string;
  }[]
}

const appFn = async (app: Application) => {

  // Sync labels when a new repo is created
  app.on('repository.created', async context => {
    const owner = context.payload.repository.owner.login;
    const repo = context.payload.repository.name;
    await reconcileLabels(owner, repo, context.github);
  });

  // On startup, synchronize labels for all relevant repos
  const reposResponse = await request<RepoResponse>({
    url: reposUrl
  });
  await Promise.all(reposResponse.data.repos.map(r => {
    const [owner, repo] = r.repo.split('/');
    return reconcileLabels(owner, repo, {} as any);
  }));
};

/**
 * Synchronize the labels for a given repository
 * @param owner The GitHub organization for the repository
 * @param repo The GitHub repository name
 * @param github The Octokit context used to make requests
 */
async function reconcileLabels(owner: string, repo: string, github: GitHubAPI) {
  const res = await github.issues.listLabelsForRepo({
    owner,
    repo,
    per_page: 100,
  });
  const oldLabels = res.data;
  const promises = new Array<Promise<unknown>>();
  labels.forEach(l => {
    // try to find a label with the same name
    const match = oldLabels.find(
      x => x.name.toLowerCase() === l.name.toLowerCase()
    );
    if (match) {
      // check to see if the color matches
      if (match.color !== l.color) {
        console.log(
          `Updating color for ${match.name} from ${match.color} to ${l.color}.`
        );
        const p = github.issues
          .updateLabel({
            repo,
            owner,
            name: l.name,
            current_name: l.name,
            description: match.description,
            color: l.color,
          })
          .catch(e => {
            console.error(
              `Error updating label ${l.name} in ${owner}/${repo}`
            );
          });
        promises.push(p);
      }
    } else {
      // there was no match, go ahead and add it
      console.log(`Creating label for ${l.name}.`);
      const p = github.issues
        .createLabel({
          repo,
          owner,
          color: l.color,
          description: l.description,
          name: l.name,
        })
        .catch(e => {
          console.error(`Error creating label ${l.name} in ${owner}/${repo}`);
        });
      promises.push(p);
    }
  });

  // now clean up common labels we don't want
  const labelsToDelete = [
    'bug',
    'enhancement',
    'kokoro:force-ci',
    'kokoro: force-run',
    'kokoro: run',
    'question',
  ];
  oldLabels.forEach(l => {
    if (labelsToDelete.includes(l.name)) {
      const p = github.issues
        .deleteLabel({
          name: l.name,
          owner,
          repo,
        })
        .then(() => {
          console.log(`Deleted '${l.name}' from ${owner}/${repo}`);
        })
        .catch(e => {
          console.error(`Error deleting label ${l.name} in ${owner}/${repo}`);
          console.error(e.stack);
        });
      promises.push(p);
    }
  });
  await Promise.all(promises);
}

const bootstrap = new GCFBootstrapper();
const label_sync = bootstrap.gcf(appFn);
export {label_sync, appFn};
