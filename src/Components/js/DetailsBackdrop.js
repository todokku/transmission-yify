import React, { Component, Fragment } from 'react';
import { FaDownload, FaPlayCircle, FaRssSquare, FaTimes, FaYoutube } from 'react-icons/fa';
import Modal from 'react-responsive-modal';
import axios from 'axios';
import YouTube from 'react-youtube';

import '../css/DetailsBackdrop.css';
import Version from './Version';
import Spinner from './Spinner';
import Ratings from './Ratings';
import Genre from '../../Data/Genre';
import { getDetails, getMovies, getSeasons, getEpisodes, hasFile, hasSubscription, parseMedia } from '../../Util/Parse';
import Cache from '../../Util/Cache';

class DetailsBackdrop extends Component {

    constructor(props) {
        super(props);
        this.state = this.getDefaultState();
    }

    getDefaultState() {
        return {tmdbData: null, moreData: null, pb: null, eztv: null, nyaa: null, season: 1, maxSeason: 1, showCover: true,
            trailerFullscreen: false, loadingEpisodes: false, subscribing: false};
    }

    getEztv(imdb, page) {
        const limit = 50;
        const url = `${this.props.server}/eztv/?limit=${limit}&page=${page}&imdb_id=${imdb}`;
        
        if (Cache[url]) {
            this.handleEztv(Cache[url], imdb, page, limit);
        } else {
            axios.get(url).then(response => {
                // Make sure that the show was found and we are not just getting
                // the newest shows on the site. This is a bad api design for them :(
                const data = response.data;
                Cache[url] = data;
                this.handleEztv(data, imdb, page, limit);
            }).catch(err => {
                console.error(err);
            });
        }
    }

    handleEztv(data, imdb, page, limit) {
        if (data.torrents_count < 2000 && data.torrents) {
            const moreData = this.state.moreData;

            let maxSeason = this.state.maxSeason;
            let newMax = false;
            data.torrents.forEach(t => {
                const s = parseInt(t.season);
                if (s > maxSeason && moreData && s <= moreData.seasons.length) { maxSeason = s; newMax = true; }
            });
            
            let eztv = this.state.eztv || data;
            if (eztv !== data) data.torrents.forEach(t => eztv.torrents.push(t));

            this.setState({ eztv: eztv, season: (page === 1 || newMax) ? maxSeason : this.state.season, maxSeason: maxSeason }, () => {
                // If there are more pages, get them
                if (page * limit < data.torrents_count) {
                    this.getEztv(imdb, page + 1);
                } else {
                    this.setState({loadingEpisodes: false});
                }
            });
        } else {
            this.setState({ eztv: {torrents: []}, loadingEpisodes: false });
        }
    }

    getNyaa(title, page) {
        const limit = 50;
        const url = `${this.props.server}/nyaa/?q=${title}&limit=${limit}&page=${page}`;

        if (Cache[url]) {
            this.handleNyaa(Cache[url], title, page, limit);
        } else {
            axios.get(url).then(response => {
                const data = response.data;
                Cache[url] = data;
                this.handleNyaa(data, title, page, limit);
            }).catch(err => {
                console.error(err);
            });
        }
    }

    handleNyaa(data, title, page, limit) {
        let nyaa = this.state.nyaa || data;
        if (nyaa !== data) data.torrents.forEach(t => nyaa.torrents.push(t));

        this.setState({nyaa: nyaa}, () => {
            // If there are more pages, get them
            if (page * limit < data.totalRecordCount) {
                this.getNyaa(title, page + 1);
            } else {
                this.setState({loadingEpisodes: false});
            }
        });
    }

    componentDidUpdate(prevProps, prevState, snapshot) {
        const { media, type } = this.props;

        if (media && media !== prevProps.media && this.state === prevState) {
            if (type === 'animes') {
                axios.get(`${this.props.server}/kitsu/${media.id}`).then(response => {
                    const data = response.data.data;
                    this.setState({
                        moreData: {
                            CoverImage: data.attributes.coverImage.large,
                            Plot: data.attributes.synopsis,
                            Rated: data.attributes.rating,
                            Genres: data.relationships.genres.data.map(g => Genre.anime.find(i => g.id === i.id).label),
                            EpisodeCount: data.attributes.episodeCount
                        },
                        loadingEpisodes: true
                    });

                    this.getNyaa(media.title, 1);
                }).catch(err => {
                    console.error(err);
                    this.setState({ moreData: "ERROR" });
                });
            } else {
                axios.get(this.props.server + '/tmdbid/' + (type === 'shows' ? 'tv/' : 'movie/') + media.id).then(response => {
                    const updated = { tmdbData: response.data, loadingEpisodes: type === 'shows' };
                    if (type === 'shows') updated.moreData = response.data;

                    this.setState(updated);
        
                    if (type === 'shows') {
                        const moreData = response.data;
                        moreData.seasons.forEach(season => {
                            axios.get(`${this.props.server}/tmdb/seasons/${media.id}/${season.season_number}`).then(response => {
                                if (moreData.seasons[season.season_number - 1]) {
                                    moreData.seasons[season.season_number - 1].episodes = response.data.episodes;
                                    this.setState({moreData: moreData});
                                }
                            }).catch(err => {
                                console.error(err);
                            })
                        });
                        
                        if (!response.data.external_ids || !response.data.external_ids.imdb_id) {
                            this.setState({ eztv: {torrents: []}, loadingEpisodes: false });
                            return;
                        }
                        const imdb = response.data.external_ids.imdb_id.replace('tt', '');
                        this.getEztv(imdb, 1);
                    } else {
                        const omdbUrl = this.props.server + '/omdb/' + response.data.imdb_id;
                        
                        if (Cache[omdbUrl]) {
                            this.setState({ moreData: Cache[omdbUrl] });
                        } else {
                            axios.get(omdbUrl).then(response => {
                                this.setState({ moreData: response.data });
                            }).catch(error => {
                                console.error(error);
                                this.setState({ moreData: "ERROR" });
                            });
                        }
        
                        const cleanedTitle = media.title.replace(/('|")/g, '').replace(/[^\w\s]/gi, ' ');
                        const pirateUrl = `${this.props.server}/pirate/${cleanedTitle} ${media.year}`;

                        if (Cache[pirateUrl]) {
                            this.setState({pb: Cache[pirateUrl]});
                        } else {
                            axios.get(pirateUrl).then(response => {
                                this.setState({pb: response.data});
                            }).catch(err => {
                                console.error(err);
                            });
                        }
                    }
                }).catch(error => {
                    console.error(error);
                    this.setState({ moreData: "ERROR" });
                });
            }
        // } else if (this.state !== prevState) {
        //     this.setState({tmdbData: null, moreData: null, pb: null, eztv: null, nyaa: null, season: 1, maxSeason: 1, showCover: true});
        }
    }

    imageError() {
        this.setState({ showCover: false });
    }

    updateSeason(season) {
        this.setState({ season: season });
    }

    downloadSeason(episodes) {
        episodes.forEach(episode => {
            if (episode.torrents.length > 0) this.props.downloadTorrent(episode.torrents[0]);
        });
    }

    toggleSubscription() {
        this.setState({subscribing: true});
        const media = this.props.media;
        this.props.toggleSubscription(media, () => setTimeout(() => this.setState({subscribing: false}), 2000));
    }

    render() {
        const { media, downloadTorrent, cancelTorrent, getLink, getTorrent, getProgress, started, type, onOpenModal, onCloseModal,
            files, status } = this.props;
        const { tmdbData, moreData, showCover, eztv, nyaa, pb, season, maxSeason, trailerFullscreen, loadingEpisodes,
            subscribing } = this.state;
        
        if (!media) return null;

        const versions = getMovies(media, pb ? pb.torrents : [], type);

        const seasons = getSeasons(type, maxSeason, moreData);
        const episodes = getEpisodes(eztv || nyaa, moreData, type);

        const details = getDetails(media, moreData, tmdbData, type, maxSeason);
        const fileExists = hasFile(media, files);

        const trailerOpts = {
            // https://developers.google.com/youtube/player_parameters
            playerVars: {
                autoplay: 1,
                modestbranding: 1
            }
        };

        let recommendations = tmdbData && tmdbData.recommendations && tmdbData.recommendations.results ? tmdbData.recommendations.results : undefined;

        return (
            <Modal
                open={media !== null}
                modalId={'modalFullscreen'}
                overlayId='overlay'
                onClose={onCloseModal}
                styles={{
                    modal: {
                        backgroundImage: (type === 'animes' ? (moreData && moreData !== 'ERROR' ? `url(${moreData.CoverImage})` : ''):
                            `url(https://image.tmdb.org/t/p/w1280/${media.backdrop_path})`)
                    },
                    closeIcon: {
                        fill: '#bbb',
                        stroke: '#bbb',
                    }
                }}
            >
                <div className="container" onClick={e => {
                    this.setState(this.getDefaultState());
                    onCloseModal();
                }}>
                    {details.trailer && trailerFullscreen ? (
                        <div className="ytContainer" onClick={e => e.stopPropagation()}>
                            <button onClick={e => { e.stopPropagation(); this.setState({trailerFullscreen: false}) }}><FaTimes/></button>
                            <YouTube videoId={details.trailer.key} opts={trailerOpts} id='youtube'
                                onEnd={() => this.setState({trailerFullscreen: false})}/>
                        </div>
                    ) : null}
                    <div className="left">
                        <div className="info">
                            <h3>{media.title}{type !== 'movies' && status && status.subscriptions ? (subscribing ?
                                <span className="subscription"><Spinner visible/></span> :
                                <FaRssSquare
                                    className={`subscription ${hasSubscription(media.id, this.props.status.subscriptions) ? 'orange': 'gray'}`}
                                    onClick={e => { e.stopPropagation(); this.toggleSubscription(); }}
                                />) : null}
                            </h3>
                            <h4>
                                <Fragment>
                                    <span>{details.header}</span>
                                    <div className="mpaa-rating">{details.mpaa}</div>
                                    {fileExists ? (
                                        <div className="fileExists">
                                            <FaPlayCircle onClick={e => { e.stopPropagation(); window.open(fileExists.url, '_blank').focus(); }}/>
                                        </div>
                                    ) : null}
                                </Fragment>
                            </h4>
                            <Ratings moreData={moreData}/>
                            {details.trailer ? (
                                <div className="trailer" onClick={e => {
                                    e.stopPropagation();
                                    this.setState({trailerFullscreen: !trailerFullscreen});
                                }}>
                                    <FaYoutube className="red"/>
                                    <div>Trailer</div>
                                </div>
                            ) : null}
                        </div>
                        <div className="spacer"></div>
                        {showCover ? (
                            <div className="coverWrap">
                                    <img
                                        src={media.poster_path}
                                        alt={media.title}
                                        onError={this.imageError.bind(this)}
                                    />
                                    {fileExists ? (
                                        <div className="fileExists">
                                            <FaPlayCircle onClick={e => { e.stopPropagation(); window.open(fileExists.url, '_blank').focus(); }}/>
                                        </div>
                                    ) : null}
                            </div>
                        ) : null }
                    </div>
                    <div className="spacer"></div>
                    <div className="right" onClick={e => e.stopPropagation()}>
                        <div className="plot padding">{details.plot}</div>
                        {details.genres ? <div className="capitalize padding">{details.genres}</div> : null}
                        
                        {type === 'movies' ? moreData !== "ERROR" && moreData !== null ? (
                            <Fragment>
                                {details.director ? <div className="padding">{details.director}</div> : null}
                                {details.writers ? <div className="padding">{details.writers}</div> : null}
                                <div className="padding">Actors: {moreData.Actors}</div>
                            </Fragment>
                        ) : (
                            <Fragment>
                                {moreData === "ERROR" || moreData !== null ? null : (
                                    <Fragment>
                                        <span>Loading additional data...<Spinner visible/></span>
                                    </Fragment>
                                )}
                            </Fragment>
                        ) : null}

                        <br/>

                        {type === 'movies' ? (
                            pb ? (
                                versions.length > 0 ? (
                                    <div className="versions">
                                        {versions.map(version => (
                                            <Version
                                                key={version.hashString}
                                                version={version}
                                                started={started}
                                                getProgress={getProgress}
                                                getLink={getLink}
                                                getTorrent={getTorrent}
                                                downloadTorrent={version => {
                                                    if (!fileExists || window.confirm("This file already exists in plex. Are you sure you want to download it again?")) downloadTorrent(version);
                                                }}
                                                cancelTorrent={cancelTorrent}
                                                hideInfo={true}
                                                hideBar={true}
                                            />
                                        ))}
                                    </div>
                                ) : <h4>No Torrents Found</h4>
                            ) : <span>Loading torrent data...<Spinner visible/></span>
                        ) : (
                            <Fragment>
                                {loadingEpisodes ? <span>Loading torrent data...<Spinner visible/></span> : null}
                                {(!eztv && !nyaa) ? null : (
                                    episodes.length === 0 ? <h4>No Torrents Found</h4> : (
                                        <Fragment>
                                            <h3 className="season">Season
                                                {seasons.length > 1 ? (
                                                    <select onChange={(event) => this.updateSeason(event.target.value)} value={season}>
                                                        {seasons.map(season => ( <option key={season} value={season}>{season}</option> ))}
                                                    </select>
                                                ) : " 1"}
                                                {(episodes[season] && episodes[season].length > 0) ? (
                                                    <button className="orange download" onClick={() => this.downloadSeason(episodes[season])}>
                                                        <FaDownload/>
                                                    </button>
                                                ) : null}
                                            </h3>
                                            {type === 'shows' && moreData && moreData.seasons && moreData.seasons[season-1] ? (
                                                <span>{moreData.seasons[season-1].overview}</span>
                                            ) : null}
                                            <div className="episodeList">
                                                {(episodes[season] && episodes[season].length > 0) ? (
                                                    episodes[season].map(episode => (
                                                        episode ? (
                                                        <Fragment key={episode.episode}>
                                                            <h4 className="episode">{episode.title}</h4>

                                                            <div className="versions">
                                                                {episode.torrents ? episode.torrents.map(version => (
                                                                <Version
                                                                    key={version.hashString}
                                                                    version={version}
                                                                    started={started}
                                                                    getProgress={getProgress}
                                                                    getLink={getLink}
                                                                    getTorrent={getTorrent}
                                                                    downloadTorrent={downloadTorrent}
                                                                    cancelTorrent={cancelTorrent}
                                                                    hideInfo={true}
                                                                    hideBar={true}
                                                                />
                                                                )) : null}
                                                            </div>
                                                        </Fragment>
                                                        ) : null
                                                    ))
                                                ) : null}
                                            </div>
                                        </Fragment>
                                    )
                                )}
                            </Fragment>
                        )}

                        {recommendations ? (
                            <Fragment>
                                <h4>You Might Also Like...</h4>
                                <div className="recommendationContainer">
                                    <div className="recommendations">
                                        {recommendations.map(r => {
                                            const recommendation = parseMedia(r, 'movies');

                                            return <div key={r.id} className="item" onClick={() => {
                                                this.setState(this.getDefaultState(), () => {
                                                    onOpenModal(recommendation);
                                                });
                                            }}>
                                                <img src={r.poster_path} alt="cover"/>
                                                <div className="title">{r.title}</div>
                                            </div>
                                        })}
                                    </div>
                                </div>
                            </Fragment>
                        ) : null}
                    </div>
                </div>
            </Modal>
        );
    }
}

export default DetailsBackdrop;